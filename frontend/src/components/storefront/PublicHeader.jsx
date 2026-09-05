import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Layers, LogIn, UserPlus, LayoutDashboard, ExternalLink } from 'lucide-react';

/** Storefront header: brand, section links, and sign-in / portal actions. */
export function PublicHeader() {
  const { user, loading } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  const isInternal = user && !isCustomer;

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <span className="font-bold text-base text-slate-900 tracking-tight">DealFlow360</span>
        </Link>

        <nav aria-label="Storefront" className="hidden md:flex items-center space-x-1 text-xs font-medium text-slate-600">
          <a href="#catalog" className="px-3 py-2 rounded-lg hover:bg-slate-50 hover:text-slate-900">
            Catalogue
          </a>
          <a href="#how-it-works" className="px-3 py-2 rounded-lg hover:bg-slate-50 hover:text-slate-900">
            How it works
          </a>
          <a href="#subscriptions" className="px-3 py-2 rounded-lg hover:bg-slate-50 hover:text-slate-900">
            Subscriptions
          </a>
        </nav>

        <div className="flex items-center space-x-2">
          {loading ? null : isCustomer ? (
            <Link
              to="/customer"
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>My portal</span>
            </Link>
          ) : isInternal ? (
            <Link
              to="/admin"
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg"
            >
              <span>Go to workspace</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign in</span>
              </Link>
              <Link
                to="/signup"
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create account</span>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
