import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
    );
  }
  return supabase;
}

/**
 * Atomic PostgreSQL RPC wrappers for the DressCode Full-Cycle ERP:
 * Purchase -> Raw Inventory (WAC) -> Manufacturing (WIP) -> Finished Goods -> Sales
 */
export const erpDb = {
  async receivePurchaseOrder(poId: string) {
    const { error } = await requireClient().rpc('receive_purchase_order', {
      p_po_id: poId,
    });
    if (error) throw error;
  },

  async issueProductionOrder(productionOrderId: string) {
    const { error } = await requireClient().rpc('issue_production_order', {
      p_prod_id: productionOrderId,
    });
    if (error) throw error;
  },

  async completeProductionOrder(productionOrderId: string) {
    const { error } = await requireClient().rpc('complete_production_order', {
      p_prod_id: productionOrderId,
    });
    if (error) throw error;
  },

  async confirmSalesOrder(salesOrderId: string) {
    const { error } = await requireClient().rpc('confirm_sales_order', {
      p_sale_id: salesOrderId,
    });
    if (error) throw error;
  },

  async getModelCostSummary() {
    const { data, error } = await requireClient()
      .from('v_model_cost_summary')
      .select('*');
    if (error) throw error;
    return data;
  },

  async getMonthlyPnL() {
    const { data, error } = await requireClient()
      .from('v_monthly_pnl')
      .select('*');
    if (error) throw error;
    return data;
  },

  async getLowStockAlerts() {
    const { data, error } = await requireClient()
      .from('v_low_stock_alerts')
      .select('*');
    if (error) throw error;
    return data;
  },
};
