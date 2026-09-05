import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'dealflow_cart';

function readCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable (private mode); the cart lives in memory only.
  }
}

/**
 * A quotation cart: catalogue variants and plans with quantities, kept in
 * localStorage so it survives a sign-in redirect. Prices here are list prices
 * for display only; the server prices the request.
 */
export function useQuoteCart() {
  const [items, setItems] = useState(readCart);

  useEffect(() => {
    writeCart(items);
  }, [items]);

  const addItem = useCallback((entry) => {
    setItems((prev) => {
      const key = entry.type === 'plan' ? `plan:${entry.id}` : `variant:${entry.id}`;
      const index = prev.findIndex((i) => i.key === key);
      if (index > -1) {
        const next = [...prev];
        next[index] = { ...next[index], quantity: next[index].quantity + (entry.quantity || 1) };
        return next;
      }
      return [
        ...prev,
        {
          key,
          type: entry.type,
          id: entry.id,
          name: entry.name,
          subtitle: entry.subtitle || '',
          price: entry.price || 0,
          cadence: entry.cadence || 'One-time',
          quantity: entry.quantity || 1,
        },
      ];
    });
  }, []);

  const removeItem = useCallback((key) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const setQuantity = useCallback((key, quantity) => {
    setItems((prev) =>
      quantity > 0
        ? prev.map((i) => (i.key === key ? { ...i, quantity } : i))
        : prev.filter((i) => i.key !== key)
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((acc, i) => acc + i.quantity, 0);
  const oneTimeTotal = items
    .filter((i) => i.type === 'variant')
    .reduce((acc, i) => acc + i.price * i.quantity, 0);

  return { items, count, oneTimeTotal, addItem, removeItem, setQuantity, clear };
}
