import React, { useState, useEffect, useCallback } from 'react';
import { api, formatINR, formatDate, formatDateTime } from '../../../services/api';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { LoadingSpinner } from '../../../components/common/LoadingState';
import { Modal } from '../../../components/common/Modal';
import { OrderFulfillmentDesk } from '../../../components/operations/OrderFulfillmentDesk';
import { ReplenishmentEditor } from '../../../components/operations/ReplenishmentEditor';
import {
  PackageCheck,
  Truck,
  Layers,
  ArrowRight,
  Plus,
  RefreshCw,
  Send,
  AlertCircle,
  Building2,
  CheckCircle2,
  Box,
} from 'lucide-react';
import { useDealEvents } from '../../../hooks/useDealEvents';

export function FulfillmentPage() {
  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'orders'
  const [stockLevels, setStockLevels] = useState([]);
  const [orders, setOrders] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Goods Receipt Modal State
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptVariantId, setReceiptVariantId] = useState('');
  const [receiptWarehouseId, setReceiptWarehouseId] = useState('');
  const [receiptQuantity, setReceiptQuantity] = useState(10);
  const [receiptNote, setReceiptNote] = useState('');
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  // Order Allocation Inspector Modal State
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [allocationData, setAllocationData] = useState(null);
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const [loadingAllocation, setLoadingAllocation] = useState(false);

  // Dispatch Runner State
  const [dispatchingId, setDispatchingId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setRefreshing(true);
      setError('');
      const [stocksRes, ordersRes, whRes, varRes] = await Promise.all([
        api.get('/stock-levels'),
        api.get('/orders?pageSize=100'),
        api.get('/warehouses'),
        api.get('/products?pageSize=100').then(async p => (await Promise.all(p.items.map(product => api.get(`/variants?productId=${product.id}`)))).flat()),
      ]);

      setStockLevels(Array.isArray(stocksRes) ? stocksRes : []);
      const orderList = ordersRes?.items || ordersRes?.content || (Array.isArray(ordersRes) ? ordersRes : []);
      setOrders(orderList);
      setWarehouses(Array.isArray(whRes) ? whRes : []);
      setVariants(Array.isArray(varRes) ? varRes : []);

      if (Array.isArray(varRes) && varRes.length > 0 && !receiptVariantId) {
        setReceiptVariantId(varRes[0].id);
      }
      if (Array.isArray(whRes) && whRes.length > 0 && !receiptWarehouseId) {
        setReceiptWarehouseId(whRes[0].id);
      }
    } catch (err) {
      console.error('Failed to load fulfillment data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh when fulfillment-related events arrive over WebSocket.
  const FULFILLMENT_EVENTS = new Set(['ALLOCATION_UPDATED', 'BACKORDER_UPDATED', 'ORDER_CREATED', 'STOCK_UPDATED']);
  useDealEvents(
    (e) => FULFILLMENT_EVENTS.has(e.type),
    loadData
  );

  const handleInspectAllocation = async (orderId) => {
    setSelectedOrderId(orderId);
    setLoadingAllocation(true);
    setAllocationModalOpen(true);
    try {
      const data = await api.get(`/orders/${orderId}/allocation`);
      setAllocationData(data);
    } catch (err) {
      alert('Unable to load allocation plan: ' + err.message);
    } finally {
      setLoadingAllocation(false);
    }
  };

  const handleRecordReceipt = async (e) => {
    e.preventDefault();
    if (!receiptVariantId || !receiptWarehouseId) return;

    setSubmittingReceipt(true);
    try {
      const payload = {
        variantId: receiptVariantId,
        warehouseId: receiptWarehouseId,
        quantity: parseInt(receiptQuantity, 10),
        movementType: 'RECEIPT',
        note: receiptNote.trim() || 'Standard warehouse goods receipt',
      };

      await api.postWithIdempotency('/stock-movements', payload);
      setReceiptModalOpen(false);
      alert('Goods receipt recorded successfully! Stock counts updated.');
      loadData();
    } catch (err) {
      alert('Failed to record stock movement: ' + err.message);
    } finally {
      setSubmittingReceipt(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {error && <p role="alert" className="error-notice">{error}</p>}
      <ReplenishmentEditor levels={stockLevels} onSaved={loadData} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Fulfillment & Stock Operations</h2>
            <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200">
              Operations Desk
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-warehouse inventory balancing, parcel dispatches, and backorder replenishment.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={loadData}
            disabled={refreshing}
            className="p-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setReceiptModalOpen(true)}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Record Goods Receipt</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-4">
        <button
          onClick={() => setActiveTab('stock')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'stock'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Box className="w-4 h-4" />
          <span>Warehouse Stock Levels ({stockLevels.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('orders')}
          className={`pb-3 text-xs font-semibold flex items-center space-x-2 border-b-2 transition-colors ${
            activeTab === 'orders'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>Order Allocations & Dispatches ({orders.length})</span>
        </button>
      </div>

      {/* Tab 1: Stock Levels */}
      {activeTab === 'stock' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3.5">SKU & Product</th>
                  <th className="px-5 py-3.5">Warehouse</th>
                  <th className="px-5 py-3.5">On Hand</th>
                  <th className="px-5 py-3.5">Reserved</th>
                  <th className="px-5 py-3.5">Available to Promise</th>
                  <th className="px-5 py-3.5">Reorder Point</th>
                  <th className="px-5 py-3.5">Health State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stockLevels.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      No stock records found in system.
                    </td>
                  </tr>
                ) : (
                  stockLevels.map((st, i) => (
                    <tr key={i} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-900">{st.sku || 'SKU Item'}</div>
                        <div className="text-[11px] text-slate-500">{st.productName}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {st.warehouseCode || 'WH-MAIN'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-slate-800 tabular-nums">{st.onHand}</td>
                      <td className="px-5 py-3.5 text-slate-500 tabular-nums">{st.reserved}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-900 tabular-nums">
                        {st.available}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 tabular-nums">{st.reorderPoint}</td>
                      <td className="px-5 py-3.5">
                        {st.needsReplenishment ? (
                          <span className="bg-rose-50 text-rose-700 text-[11px] font-bold px-2 py-0.5 rounded border border-rose-200">
                            Low Stock Alert
                          </span>
                        ) : (
                          <span className="bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-0.5 rounded border border-emerald-200">
                            Sufficient
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Orders & Dispatches */}
      {activeTab === 'orders' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Order Reference</th>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Fulfillment Status</th>
                  <th className="px-5 py-3.5">Confirmed Date</th>
                  <th className="px-5 py-3.5">Total Value</th>
                  <th className="px-5 py-3.5 text-right">Allocation Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No customer orders ready for allocation.
                    </td>
                  </tr>
                ) : (
                  orders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-900">{ord.reference}</div>
                        <div className="text-[11px] text-slate-400 font-mono">ID: {ord.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-slate-800">{ord.customerName || 'Customer'}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={ord.fulfillmentStatus || 'ALLOCATED'} />
                      </td>
                      <td className="px-5 py-3.5 text-slate-500">{formatDate(ord.confirmedAt || ord.createdAt)}</td>
                      <td className="px-5 py-3.5 font-semibold text-slate-900 tabular-nums">
                        {formatINR(ord.total || ord.oneTimeNet)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => handleInspectAllocation(ord.id)}
                          className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded text-xs transition-colors"
                        >
                          View Split Plan &rarr;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record Goods Receipt Modal */}
      <Modal
        isOpen={receiptModalOpen}
        onClose={() => setReceiptModalOpen(false)}
        title="Record Goods Receipt & Inventory Inward"
        subtitle="Receipt increases on-hand stock and satisfies backordered allocations."
      >
        <form onSubmit={handleRecordReceipt} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-700 mb-1">Product Variant (SKU)</label>
            <select
              value={receiptVariantId}
              onChange={(e) => setReceiptVariantId(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white font-medium"
              required
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.sku} — {v.name || 'Product'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Destination Warehouse</label>
            <select
              value={receiptWarehouseId}
              onChange={(e) => setReceiptWarehouseId(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white font-medium"
              required
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name} ({w.city || 'India'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Received Units Count</label>
            <input
              type="number"
              min="1"
              required
              value={receiptQuantity}
              onChange={(e) => setReceiptQuantity(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Inward Goods Note / Bill of Lading</label>
            <input
              type="text"
              value={receiptNote}
              onChange={(e) => setReceiptNote(e.target.value)}
              placeholder="E.g., PO #1042 Shipment from Supplier"
              className="w-full p-2.5 border border-slate-200 rounded-lg bg-white"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setReceiptModalOpen(false)}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingReceipt}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-semibold rounded-lg"
            >
              <span>{submittingReceipt ? 'Recording Inward...' : 'Confirm Goods Receipt'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Allocation Inspector Modal */}
      <Modal
        isOpen={allocationModalOpen}
        onClose={() => setAllocationModalOpen(false)}
        title="Multi-Warehouse Allocation Plan"
        subtitle={`Order Split Analysis for ID: ${selectedOrderId?.slice(0, 8)}`}
        maxWidth="max-w-2xl"
      >
        {selectedOrderId && <OrderFulfillmentDesk orderId={selectedOrderId} warehouses={warehouses} onChanged={loadData} />}
      </Modal>
    </div>
  );
}
