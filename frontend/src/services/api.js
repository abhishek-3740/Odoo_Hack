// API client with JWT authentication, idempotency key generation, and error handling

const API_BASE = '/api/v1';

export function getStoredToken() {
  return localStorage.getItem('dealflow_token') || '';
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem('dealflow_token', token);
  } else {
    localStorage.removeItem('dealflow_token');
  }
}

export function generateIdempotencyKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'idemp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const token = getStoredToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  // If this is a mutation (POST, PATCH, PUT, DELETE) and requireIdempotency is true (or default for critical paths)
  if (options.idempotent && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = generateIdempotencyKey();
  }

  const config = {
    ...options,
    headers,
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, config);

    // Handle 401 Unauthorized
    if (response.status === 401) {
      // Optional: signal unauthorized
      console.warn('Unauthorized request to', url);
    }

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    let data = null;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { raw: text };
    }

    if (!response.ok) {
      const errorMessage = data?.error?.message || data?.message || `HTTP ${response.status}: ${response.statusText}`;
      const err = new Error(errorMessage);
      err.status = response.status;
      err.code = data?.error?.code || 'UNKNOWN_ERROR';
      err.details = data?.error?.details || [];
      throw err;
    }

    return data?.data !== undefined ? data.data : data;
  } catch (err) {
    console.error(`API Error [${options.method || 'GET'} ${endpoint}]:`, err);
    throw err;
  }
}

// Convenience methods
export const api = {
  get: (url, options = {}) => apiRequest(url, { ...options, method: 'GET' }),
  post: (url, body, options = {}) => apiRequest(url, { ...options, method: 'POST', body }),
  postWithIdempotency: (url, body, options = {}) =>
    apiRequest(url, { ...options, method: 'POST', body, idempotent: true }),
  patch: (url, body, options = {}) => apiRequest(url, { ...options, method: 'PATCH', body }),
  patchWithIdempotency: (url, body, options = {}) =>
    apiRequest(url, { ...options, method: 'PATCH', body, idempotent: true }),
  delete: (url, options = {}) => apiRequest(url, { ...options, method: 'DELETE' }),

  // Blob downloads (e.g. PDF, XLSX exports)
  download: async (url, filename) => {
    const token = getStoredToken();
    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    const response = await fetch(fullUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new Error(`Export download failed: ${response.statusText}`);
    }
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename || 'export.dat';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  },
};

// Monetary and number formatting helpers
export function formatINR(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '₹0.00';
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.0%';
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return `${num.toFixed(decimals)}%`;
}

export function bpToPercent(bp) {
  if (bp === null || bp === undefined) return 0;
  return bp / 100;
}

export function percentToBp(percent) {
  if (!percent) return 0;
  return Math.round(parseFloat(percent) * 100);
}

export function formatDate(dateString) {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString) {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return dateString;
  }
}
