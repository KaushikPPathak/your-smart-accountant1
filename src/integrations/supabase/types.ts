export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          email: string | null
          financial_year_start: string
          gstin: string | null
          id: string
          name: string
          phone: string | null
          state: string | null
          state_code: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          financial_year_start?: string
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          state?: string | null
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          financial_year_start?: string
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          state?: string | null
          state_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["company_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["company_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["company_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          company_id: string
          created_at: string
          gst_rate: number
          hsn_code: string | null
          id: string
          is_active: boolean
          name: string
          opening_stock_qty: number
          opening_stock_rate_paise: number
          reorder_level: number
          unit: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_active?: boolean
          name: string
          opening_stock_qty?: number
          opening_stock_rate_paise?: number
          reorder_level?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_active?: boolean
          name?: string
          opening_stock_qty?: number
          opening_stock_rate_paise?: number
          reorder_level?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ledgers: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          is_active: boolean
          name: string
          opening_balance_is_debit: boolean
          opening_balance_paise: number
          phone: string | null
          state: string | null
          state_code: string | null
          type: Database["public"]["Enums"]["ledger_type"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name: string
          opening_balance_is_debit?: boolean
          opening_balance_paise?: number
          phone?: string | null
          state?: string | null
          state_code?: string | null
          type: Database["public"]["Enums"]["ledger_type"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name?: string
          opening_balance_is_debit?: boolean
          opening_balance_paise?: number
          phone?: string | null
          state?: string | null
          state_code?: string | null
          type?: Database["public"]["Enums"]["ledger_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledgers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      voucher_entries: {
        Row: {
          created_at: string
          credit_paise: number
          debit_paise: number
          id: string
          ledger_id: string
          line_no: number
          narration: string | null
          voucher_id: string
        }
        Insert: {
          created_at?: string
          credit_paise?: number
          debit_paise?: number
          id?: string
          ledger_id: string
          line_no?: number
          narration?: string | null
          voucher_id: string
        }
        Update: {
          created_at?: string
          credit_paise?: number
          debit_paise?: number
          id?: string
          ledger_id?: string
          line_no?: number
          narration?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_entries_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_entries_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_items: {
        Row: {
          amount_paise: number
          cgst_paise: number
          created_at: string
          description: string | null
          discount_paise: number
          gst_rate: number
          id: string
          igst_paise: number
          item_id: string
          line_no: number
          qty: number
          rate_paise: number
          sgst_paise: number
          taxable_paise: number
          voucher_id: string
        }
        Insert: {
          amount_paise?: number
          cgst_paise?: number
          created_at?: string
          description?: string | null
          discount_paise?: number
          gst_rate?: number
          id?: string
          igst_paise?: number
          item_id: string
          line_no?: number
          qty?: number
          rate_paise?: number
          sgst_paise?: number
          taxable_paise?: number
          voucher_id: string
        }
        Update: {
          amount_paise?: number
          cgst_paise?: number
          created_at?: string
          description?: string | null
          discount_paise?: number
          gst_rate?: number
          id?: string
          igst_paise?: number
          item_id?: string
          line_no?: number
          qty?: number
          rate_paise?: number
          sgst_paise?: number
          taxable_paise?: number
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_items_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_number_seq: {
        Row: {
          company_id: string
          next_number: number
          prefix: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          company_id: string
          next_number?: number
          prefix?: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          company_id?: string
          next_number?: number
          prefix?: string
          voucher_type?: Database["public"]["Enums"]["voucher_type"]
        }
        Relationships: [
          {
            foreignKeyName: "voucher_number_seq_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          cgst_paise: number
          company_id: string
          created_at: string
          created_by: string
          id: string
          igst_paise: number
          is_interstate: boolean
          narration: string | null
          party_ledger_id: string | null
          reference_no: string | null
          sgst_paise: number
          subtotal_paise: number
          total_paise: number
          updated_at: string
          voucher_date: string
          voucher_number: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          cgst_paise?: number
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          igst_paise?: number
          is_interstate?: boolean
          narration?: string | null
          party_ledger_id?: string | null
          reference_no?: string | null
          sgst_paise?: number
          subtotal_paise?: number
          total_paise?: number
          updated_at?: string
          voucher_date: string
          voucher_number: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          cgst_paise?: number
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          igst_paise?: number
          is_interstate?: boolean
          narration?: string | null
          party_ledger_id?: string | null
          reference_no?: string | null
          sgst_paise?: number
          subtotal_paise?: number
          total_paise?: number
          updated_at?: string
          voucher_date?: string
          voucher_number?: string
          voucher_type?: Database["public"]["Enums"]["voucher_type"]
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_party_ledger_id_fkey"
            columns: ["party_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_write_company: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      has_company_role: {
        Args: {
          _company_id: string
          _role: Database["public"]["Enums"]["company_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      next_voucher_number: {
        Args: {
          _company_id: string
          _type: Database["public"]["Enums"]["voucher_type"]
        }
        Returns: string
      }
      voucher_company_id: { Args: { _voucher_id: string }; Returns: string }
    }
    Enums: {
      company_role: "admin" | "accountant" | "viewer"
      ledger_type:
        | "sundry_debtor"
        | "sundry_creditor"
        | "cash"
        | "bank"
        | "expense_direct"
        | "expense_indirect"
        | "income_direct"
        | "income_indirect"
        | "fixed_asset"
        | "current_asset"
        | "current_liability"
        | "loan_liability"
        | "capital"
        | "duties_taxes"
        | "stock_in_hand"
      voucher_type:
        | "sales"
        | "purchase"
        | "receipt"
        | "payment"
        | "journal"
        | "contra"
        | "credit_note"
        | "debit_note"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      company_role: ["admin", "accountant", "viewer"],
      ledger_type: [
        "sundry_debtor",
        "sundry_creditor",
        "cash",
        "bank",
        "expense_direct",
        "expense_indirect",
        "income_direct",
        "income_indirect",
        "fixed_asset",
        "current_asset",
        "current_liability",
        "loan_liability",
        "capital",
        "duties_taxes",
        "stock_in_hand",
      ],
      voucher_type: [
        "sales",
        "purchase",
        "receipt",
        "payment",
        "journal",
        "contra",
        "credit_note",
        "debit_note",
      ],
    },
  },
} as const
