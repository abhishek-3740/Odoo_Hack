import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getStoredToken, setStoredToken } from '../services/api';
import { initWebSocket, disconnectWebSocket } from '../services/websocket';

const AuthContext = createContext(null);

/** Where a role lands after sign-in; a customer's own preference wins. */
export function landingPathFor(user) {
  const role = (user?.role || '').toUpperCase();
  if (role === 'CUSTOMER') {
    const landing = user?.preferences?.defaultLanding;
    if (landing === 'catalog') return '/customer/catalog';
    if (landing === 'quotes') return '/customer/quotes';
    return '/customer';
  }
  if (role === 'REP') return '/admin/sales/quotes';
  if (role === 'MANAGER') return '/admin/manager/approvals';
  if (role === 'FINANCE') return '/admin/finance/approvals';
  return '/admin';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(getStoredToken());
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch current user details via /api/v1/me (+ portal preferences for customers)
  const loadCurrentUser = useCallback(async (activeToken) => {
    if (!activeToken) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      setLoading(true);
      const profile = await api.get('/me');
      let merged = profile;
      if (profile?.role === 'CUSTOMER') {
        try {
          const account = await api.get('/portal/account');
          merged = { ...profile, preferences: account?.preferences || {}, account };
        } catch {
          merged = { ...profile, preferences: {} };
        }
      }
      setUser(merged);
      setError(null);
      // Initialize STOMP websocket for real-time invalidations
      initWebSocket(activeToken);
      return merged;
    } catch (err) {
      console.warn('Failed to load user profile with current token:', err);
      // Token might be expired or invalid
      setStoredToken('');
      setToken('');
      setUser(null);
      disconnectWebSocket();
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch demo accounts list (only exists when demo auth is switched on)
  const loadDemoAccounts = useCallback(async () => {
    try {
      const accounts = await api.get('/auth/demo-accounts');
      if (Array.isArray(accounts)) {
        setDemoAccounts(accounts);
      }
    } catch {
      setDemoAccounts([]);
    }
  }, []);

  // On mount: fetch demo accounts and load user if token exists
  useEffect(() => {
    loadDemoAccounts();
    const stored = getStoredToken();
    if (stored) {
      loadCurrentUser(stored);
    } else {
      setLoading(false);
    }
  }, [loadCurrentUser, loadDemoAccounts]);

  const adoptToken = async (newToken) => {
    setStoredToken(newToken);
    setToken(newToken);
    return loadCurrentUser(newToken);
  };

  // Standard login with credentials (local password or demo persona)
  const login = async (email, password) => {
    try {
      setLoading(true);
      const res = await api.post('/auth/login', { email, password });
      const profile = await adoptToken(res.accessToken);
      return { success: true, profile, role: res.role, targetPath: landingPathFor(profile || res) };
    } catch (err) {
      setError(err.message || 'Login failed');
      return { success: false, error: err.message, code: err.code, status: err.status };
    } finally {
      setLoading(false);
    }
  };

  // Storefront self-registration: always a customer account
  const register = async (payload) => {
    try {
      setLoading(true);
      const res = await api.post('/auth/register', payload);
      const profile = await adoptToken(res.accessToken);
      return { success: true, profile, targetPath: landingPathFor(profile || res) };
    } catch (err) {
      return { success: false, error: err.message, code: err.code, status: err.status };
    } finally {
      setLoading(false);
    }
  };

  // Internal staff registration: Admin, Manager, Rep, Finance
  const registerInternal = async (payload) => {
    try {
      setLoading(true);
      const res = await api.post('/auth/register-internal', payload);
      const profile = await adoptToken(res.accessToken);
      return { success: true, profile, role: res.role, targetPath: landingPathFor(profile || res) };
    } catch (err) {
      return { success: false, error: err.message, code: err.code, status: err.status };
    } finally {
      setLoading(false);
    }
  };

  // 1-Click Demo Persona Switcher
  const switchPersona = async (account) => {
    try {
      setLoading(true);
      const profile = await adoptToken(account.token);
      const role = (profile?.role || account.role || '').toUpperCase();
      return { success: true, targetPath: landingPathFor(profile || { role }), role };
    } catch (err) {
      console.error('Error switching persona:', err);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setStoredToken('');
    setToken('');
    setUser(null);
    disconnectWebSocket();
  };

  const updateUserLocal = (patch) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const hasCapability = (cap) => {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    return Array.isArray(user.capabilities) && user.capabilities.includes(cap);
  };

  const hasRole = (...roles) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        demoAccounts,
        login,
        register,
        registerInternal,
        switchPersona,
        logout,
        updateUserLocal,
        hasCapability,
        hasRole,
        refreshUser: () => loadCurrentUser(getStoredToken()),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
