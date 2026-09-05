import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getStoredToken, setStoredToken } from '../services/api';
import { initWebSocket, disconnectWebSocket } from '../services/websocket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(getStoredToken());
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch current user details via /api/v1/me
  const loadCurrentUser = useCallback(async (activeToken) => {
    if (!activeToken) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      setLoading(true);
      const profile = await api.get('/me');
      setUser(profile);
      setError(null);
      // Initialize STOMP websocket for real-time invalidations
      initWebSocket(activeToken);
      return profile;
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

  // Fetch demo accounts list
  const loadDemoAccounts = useCallback(async () => {
    try {
      const accounts = await api.get('/auth/demo-accounts');
      if (Array.isArray(accounts)) {
        setDemoAccounts(accounts);
      }
    } catch (err) {
      console.warn('Failed to load demo accounts:', err);
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

  // Standard login with credentials
  const login = async (email, password) => {
    try {
      setLoading(true);
      const res = await api.post('/auth/login', { email, password });
      const newToken = res.accessToken;
      setStoredToken(newToken);
      setToken(newToken);
      const profile = await loadCurrentUser(newToken);
      return { success: true, profile, role: res.role };
    } catch (err) {
      setError(err.message || 'Login failed');
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // 1-Click Demo Persona Switcher
  const switchPersona = async (account) => {
    try {
      setLoading(true);
      const newToken = account.token;
      setStoredToken(newToken);
      setToken(newToken);
      const profile = await loadCurrentUser(newToken);

      // Determine default landing page
      let targetPath = '/admin';
      const role = (profile?.role || account.role || '').toUpperCase();
      if (role === 'CUSTOMER') {
        targetPath = '/customer';
      } else if (role === 'REP') {
        targetPath = '/admin/sales';
      } else if (role === 'MANAGER') {
        targetPath = '/admin/manager';
      } else if (role === 'FINANCE') {
        targetPath = '/admin/finance';
      } else if (role === 'ADMIN') {
        targetPath = '/admin';
      }

      return { success: true, targetPath, role };
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
        switchPersona,
        logout,
        hasCapability,
        hasRole,
        refreshUser: () => loadCurrentUser(token),
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
