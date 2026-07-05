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
      account_group_overrides: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          group_code: string
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deleted_at?: string | null
          group_code: string
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          group_code?: string
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      account_subgroups: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          parent_group_code: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          parent_group_code: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          parent_group_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          failed_attempts: number
          hide_from_picker: boolean
          id: string
          is_active: boolean
          last_unlock_at: string | null
          locked_until: string | null
          name: string
          password_hash: string | null
          pin_hash: string | null
          role: Database["public"]["Enums"]["app_user_role"]
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          failed_attempts?: number
          hide_from_picker?: boolean
          id?: string
          is_active?: boolean
          last_unlock_at?: string | null
          locked_until?: string | null
          name: string
          password_hash?: string | null
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["app_user_role"]
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          failed_attempts?: number
          hide_from_picker?: boolean
          id?: string
          is_active?: boolean
          last_unlock_at?: string | null
          locked_until?: string | null
          name?: string
          password_hash?: string | null
          pin_hash?: string | null
          role?: Database["public"]["Enums"]["app_user_role"]
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      bank_statement_lines: {
        Row: {
          balance_paise: number | null
          cleared_date: string | null
          company_id: string
          created_at: string
          credit_paise: number
          debit_paise: number
          description: string | null
          id: string
          match_status: string
          matched_entry_id: string | null
          matched_voucher_id: string | null
          reference: string | null
          statement_id: string
          txn_date: string
        }
        Insert: {
          balance_paise?: number | null
          cleared_date?: string | null
          company_id: string
          created_at?: string
          credit_paise?: number
          debit_paise?: number
          description?: string | null
          id?: string
          match_status?: string
          matched_entry_id?: string | null
          matched_voucher_id?: string | null
          reference?: string | null
          statement_id: string
          txn_date: string
        }
        Update: {
          balance_paise?: number | null
          cleared_date?: string | null
          company_id?: string
          created_at?: string
          credit_paise?: number
          debit_paise?: number
          description?: string | null
          id?: string
          match_status?: string
          matched_entry_id?: string | null
          matched_voucher_id?: string | null
          reference?: string | null
          statement_id?: string
          txn_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_matched_entry_id_fkey"
            columns: ["matched_entry_id"]
            isOneToOne: false
            referencedRelation: "voucher_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_matched_voucher_id_fkey"
            columns: ["matched_voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statements: {
        Row: {
          bank_ledger_id: string
          company_id: string
          file_name: string | null
          from_date: string | null
          id: string
          imported_at: string
          imported_by: string
          matched_lines: number
          to_date: string | null
          total_lines: number
        }
        Insert: {
          bank_ledger_id: string
          company_id: string
          file_name?: string | null
          from_date?: string | null
          id?: string
          imported_at?: string
          imported_by: string
          matched_lines?: number
          to_date?: string | null
          total_lines?: number
        }
        Update: {
          bank_ledger_id?: string
          company_id?: string
          file_name?: string | null
          from_date?: string | null
          id?: string
          imported_at?: string
          imported_by?: string
          matched_lines?: number
          to_date?: string | null
          total_lines?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_bank_ledger_id_fkey"
            columns: ["bank_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_allocations: {
        Row: {
          amount_paise: number
          company_id: string
          created_at: string
          id: string
          invoice_voucher_id: string
          ledger_id: string
          payment_voucher_id: string
        }
        Insert: {
          amount_paise?: number
          company_id: string
          created_at?: string
          id?: string
          invoice_voucher_id: string
          ledger_id: string
          payment_voucher_id: string
        }
        Update: {
          amount_paise?: number
          company_id?: string
          created_at?: string
          id?: string
          invoice_voucher_id?: string
          ledger_id?: string
          payment_voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_allocations_invoice_voucher_id_fkey"
            columns: ["invoice_voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_allocations_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_allocations_payment_voucher_id_fkey"
            columns: ["payment_voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_template_lines: {
        Row: {
          created_at: string
          id: string
          input_item_id: string
          line_no: number
          qty_per_output: number
          specs: Json | null
          template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_item_id: string
          line_no?: number
          qty_per_output?: number
          specs?: Json | null
          template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input_item_id?: string
          line_no?: number
          qty_per_output?: number
          specs?: Json | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bom_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "bom_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          notes: string | null
          output_item_id: string
          output_qty: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          output_item_id: string
          output_qty?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          output_item_id?: string
          output_qty?: number
          updated_at?: string
        }
        Relationships: []
      }
      closing_runs: {
        Row: {
          capital_voucher_id: string | null
          closing_stock_paise: number
          closing_stock_voucher_id: string | null
          company_id: string
          fy_end: string
          fy_start: string
          id: string
          notes: string | null
          performed_at: string
          performed_by: string
          pl_voucher_id: string | null
          status: string
          trading_voucher_id: string | null
        }
        Insert: {
          capital_voucher_id?: string | null
          closing_stock_paise?: number
          closing_stock_voucher_id?: string | null
          company_id: string
          fy_end: string
          fy_start: string
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by: string
          pl_voucher_id?: string | null
          status?: string
          trading_voucher_id?: string | null
        }
        Update: {
          capital_voucher_id?: string | null
          closing_stock_paise?: number
          closing_stock_voucher_id?: string | null
          company_id?: string
          fy_end?: string
          fy_start?: string
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by?: string
          pl_voucher_id?: string | null
          status?: string
          trading_voucher_id?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          access_password_hash: string | null
          access_password_set_at: string | null
          address: string | null
          annual_turnover_paise: number
          bank_account_no: string | null
          bank_branch: string | null
          bank_ifsc: string | null
          bank_name: string | null
          cin: string | null
          corpus_fund_paise: number
          created_at: string
          created_by: string
          currency_code: string
          date_format: string
          email: string | null
          entity_status: Database["public"]["Enums"]["entity_status"]
          financial_year_start: string
          gst_filing_frequency: string
          gst_registered: boolean
          gstin: string | null
          id: string
          inventory_enabled: boolean
          logo_url: string | null
          mode: string
          name: string
          owner_app_user_id: string | null
          pan: string | null
          phone: string | null
          share_capital_paise: number
          state: string | null
          state_code: string | null
          updated_at: string
        }
        Insert: {
          access_password_hash?: string | null
          access_password_set_at?: string | null
          address?: string | null
          annual_turnover_paise?: number
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          cin?: string | null
          corpus_fund_paise?: number
          created_at?: string
          created_by: string
          currency_code?: string
          date_format?: string
          email?: string | null
          entity_status?: Database["public"]["Enums"]["entity_status"]
          financial_year_start?: string
          gst_filing_frequency?: string
          gst_registered?: boolean
          gstin?: string | null
          id?: string
          inventory_enabled?: boolean
          logo_url?: string | null
          mode?: string
          name: string
          owner_app_user_id?: string | null
          pan?: string | null
          phone?: string | null
          share_capital_paise?: number
          state?: string | null
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          access_password_hash?: string | null
          access_password_set_at?: string | null
          address?: string | null
          annual_turnover_paise?: number
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          cin?: string | null
          corpus_fund_paise?: number
          created_at?: string
          created_by?: string
          currency_code?: string
          date_format?: string
          email?: string | null
          entity_status?: Database["public"]["Enums"]["entity_status"]
          financial_year_start?: string
          gst_filing_frequency?: string
          gst_registered?: boolean
          gstin?: string | null
          id?: string
          inventory_enabled?: boolean
          logo_url?: string | null
          mode?: string
          name?: string
          owner_app_user_id?: string | null
          pan?: string | null
          phone?: string | null
          share_capital_paise?: number
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
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          company_id: string
          created_at: string
          einvoice_enabled: boolean
          ewaybill_enabled: boolean
          gst_filing_frequency: string
          invoice_footer_note: string | null
          invoice_prefix: string
          invoice_starting_number: number
          invoice_terms: string | null
          reminder_template: string | null
          show_bank_details: boolean
          show_signatory: boolean
          theme: string
          updated_at: string
          upi_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          einvoice_enabled?: boolean
          ewaybill_enabled?: boolean
          gst_filing_frequency?: string
          invoice_footer_note?: string | null
          invoice_prefix?: string
          invoice_starting_number?: number
          invoice_terms?: string | null
          reminder_template?: string | null
          show_bank_details?: boolean
          show_signatory?: boolean
          theme?: string
          updated_at?: string
          upi_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          einvoice_enabled?: boolean
          ewaybill_enabled?: boolean
          gst_filing_frequency?: string
          invoice_footer_note?: string | null
          invoice_prefix?: string
          invoice_starting_number?: number
          invoice_terms?: string | null
          reminder_template?: string | null
          show_bank_details?: boolean
          show_signatory?: boolean
          theme?: string
          updated_at?: string
          upi_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      einvoice_api_log: {
        Row: {
          action: string
          company_id: string
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          request_summary: Json | null
          response_summary: Json | null
          success: boolean
          voucher_id: string | null
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          request_summary?: Json | null
          response_summary?: Json | null
          success?: boolean
          voucher_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          request_summary?: Json | null
          response_summary?: Json | null
          success?: boolean
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "einvoice_api_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "einvoice_api_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "einvoice_api_log_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      einvoice_details: {
        Row: {
          ack_date: string | null
          ack_no: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          company_id: string
          created_at: string
          distance_km: number | null
          ewb_date: string | null
          ewb_no: string | null
          ewb_valid_until: string | null
          irn: string | null
          signed_invoice: string | null
          signed_qr: string | null
          status: string
          transporter_id: string | null
          transporter_name: string | null
          updated_at: string
          vehicle_no: string | null
          voucher_id: string
        }
        Insert: {
          ack_date?: string | null
          ack_no?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_id: string
          created_at?: string
          distance_km?: number | null
          ewb_date?: string | null
          ewb_no?: string | null
          ewb_valid_until?: string | null
          irn?: string | null
          signed_invoice?: string | null
          signed_qr?: string | null
          status?: string
          transporter_id?: string | null
          transporter_name?: string | null
          updated_at?: string
          vehicle_no?: string | null
          voucher_id: string
        }
        Update: {
          ack_date?: string | null
          ack_no?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_id?: string
          created_at?: string
          distance_km?: number | null
          ewb_date?: string | null
          ewb_no?: string | null
          ewb_valid_until?: string | null
          irn?: string | null
          signed_invoice?: string | null
          signed_qr?: string | null
          status?: string
          transporter_id?: string | null
          transporter_name?: string | null
          updated_at?: string
          vehicle_no?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "einvoice_details_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "einvoice_details_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "einvoice_details_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: true
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_members: {
        Row: {
          aadhaar_last4: string | null
          address: string | null
          appointed_on: string | null
          capital_contribution_paise: number
          company_id: string
          created_at: string
          designation: string | null
          din: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          member_role: string
          notes: string | null
          pan: string | null
          phone: string | null
          profit_sharing_ratio: number
          resigned_on: string | null
          share_percent: number
          updated_at: string
        }
        Insert: {
          aadhaar_last4?: string | null
          address?: string | null
          appointed_on?: string | null
          capital_contribution_paise?: number
          company_id: string
          created_at?: string
          designation?: string | null
          din?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          member_role: string
          notes?: string | null
          pan?: string | null
          phone?: string | null
          profit_sharing_ratio?: number
          resigned_on?: string | null
          share_percent?: number
          updated_at?: string
        }
        Update: {
          aadhaar_last4?: string | null
          address?: string | null
          appointed_on?: string | null
          capital_contribution_paise?: number
          company_id?: string
          created_at?: string
          designation?: string | null
          din?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          member_role?: string
          notes?: string | null
          pan?: string | null
          phone?: string | null
          profit_sharing_ratio?: number
          resigned_on?: string | null
          share_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      gst_api_credentials: {
        Row: {
          company_id: string
          created_at: string
          einvoice_enabled: boolean
          environment: string
          ewaybill_enabled: boolean
          gstn_password_encrypted: string | null
          gstn_username: string | null
          last_token: string | null
          last_token_expires_at: string | null
          provider: string
          setu_client_id: string | null
          setu_client_secret: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          einvoice_enabled?: boolean
          environment?: string
          ewaybill_enabled?: boolean
          gstn_password_encrypted?: string | null
          gstn_username?: string | null
          last_token?: string | null
          last_token_expires_at?: string | null
          provider?: string
          setu_client_id?: string | null
          setu_client_secret?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          einvoice_enabled?: boolean
          environment?: string
          ewaybill_enabled?: boolean
          gstn_password_encrypted?: string | null
          gstn_username?: string | null
          last_token?: string | null
          last_token_expires_at?: string | null
          provider?: string
          setu_client_id?: string | null
          setu_client_secret?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gst_api_credentials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gst_api_credentials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr2b_imports: {
        Row: {
          company_id: string
          file_name: string | null
          id: string
          imported_at: string
          imported_by: string
          matched_lines: number
          period: string
          source: string
          total_lines: number
        }
        Insert: {
          company_id: string
          file_name?: string | null
          id?: string
          imported_at?: string
          imported_by: string
          matched_lines?: number
          period: string
          source?: string
          total_lines?: number
        }
        Update: {
          company_id?: string
          file_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string
          matched_lines?: number
          period?: string
          source?: string
          total_lines?: number
        }
        Relationships: [
          {
            foreignKeyName: "gstr2b_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gstr2b_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr2b_lines: {
        Row: {
          cess_paise: number
          cgst_paise: number
          company_id: string
          created_at: string
          id: string
          igst_paise: number
          import_id: string
          invoice_date: string | null
          invoice_no: string
          invoice_value_paise: number
          manual_override: boolean
          match_status: string
          matched_voucher_id: string | null
          remarks: string | null
          sgst_paise: number
          supplier_gstin: string
          supplier_name: string | null
          taxable_paise: number
        }
        Insert: {
          cess_paise?: number
          cgst_paise?: number
          company_id: string
          created_at?: string
          id?: string
          igst_paise?: number
          import_id: string
          invoice_date?: string | null
          invoice_no: string
          invoice_value_paise?: number
          manual_override?: boolean
          match_status?: string
          matched_voucher_id?: string | null
          remarks?: string | null
          sgst_paise?: number
          supplier_gstin: string
          supplier_name?: string | null
          taxable_paise?: number
        }
        Update: {
          cess_paise?: number
          cgst_paise?: number
          company_id?: string
          created_at?: string
          id?: string
          igst_paise?: number
          import_id?: string
          invoice_date?: string | null
          invoice_no?: string
          invoice_value_paise?: number
          manual_override?: boolean
          match_status?: string
          matched_voucher_id?: string | null
          remarks?: string | null
          sgst_paise?: number
          supplier_gstin?: string
          supplier_name?: string | null
          taxable_paise?: number
        }
        Relationships: [
          {
            foreignKeyName: "gstr2b_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gstr2b_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gstr2b_lines_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gstr2b_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gstr2b_lines_matched_voucher_id_fkey"
            columns: ["matched_voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr3b_inward_summary: {
        Row: {
          company_id: string
          created_at: string
          id: string
          inter_paise: number
          intra_paise: number
          period: string
          ty: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          inter_paise?: number
          intra_paise?: number
          period: string
          ty: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          inter_paise?: number
          intra_paise?: number
          period?: string
          ty?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr3b_inward_summary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gstr3b_inward_summary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      gstr3b_itc_reversal: {
        Row: {
          camt_paise: number
          company_id: string
          created_at: string
          csamt_paise: number
          iamt_paise: number
          id: string
          period: string
          samt_paise: number
          ty: string
          updated_at: string
        }
        Insert: {
          camt_paise?: number
          company_id: string
          created_at?: string
          csamt_paise?: number
          iamt_paise?: number
          id?: string
          period: string
          samt_paise?: number
          ty: string
          updated_at?: string
        }
        Update: {
          camt_paise?: number
          company_id?: string
          created_at?: string
          csamt_paise?: number
          iamt_paise?: number
          id?: string
          period?: string
          samt_paise?: number
          ty?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gstr3b_itc_reversal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gstr3b_itc_reversal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          file_name: string | null
          id: string
          items_created: number
          label: string | null
          ledgers_created: number
          source: string
          vouchers_created: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          file_name?: string | null
          id?: string
          items_created?: number
          label?: string | null
          ledgers_created?: number
          source?: string
          vouchers_created?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          file_name?: string | null
          id?: string
          items_created?: number
          label?: string | null
          ledgers_created?: number
          source?: string
          vouchers_created?: number
        }
        Relationships: []
      }
      it_43b_clearances: {
        Row: {
          cleared_on: string | null
          cleared_paise: number
          company_id: string
          created_at: string
          fy_end: string
          id: string
          ledger_id: string
          notes: string | null
          reference: string | null
          updated_at: string
        }
        Insert: {
          cleared_on?: string | null
          cleared_paise?: number
          company_id: string
          created_at?: string
          fy_end: string
          id?: string
          ledger_id: string
          notes?: string | null
          reference?: string | null
          updated_at?: string
        }
        Update: {
          cleared_on?: string | null
          cleared_paise?: number
          company_id?: string
          created_at?: string
          fy_end?: string
          id?: string
          ledger_id?: string
          notes?: string | null
          reference?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      it_asset_blocks: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          name: string
          rate_pct: number
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          name: string
          rate_pct: number
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          rate_pct?: number
        }
        Relationships: []
      }
      it_asset_movements: {
        Row: {
          amount_paise: number
          asset_id: string
          company_id: string
          created_at: string
          fy_start: string
          id: string
          kind: string
          movement_date: string
          notes: string | null
        }
        Insert: {
          amount_paise?: number
          asset_id: string
          company_id: string
          created_at?: string
          fy_start: string
          id?: string
          kind: string
          movement_date: string
          notes?: string | null
        }
        Update: {
          amount_paise?: number
          asset_id?: string
          company_id?: string
          created_at?: string
          fy_start?: string
          id?: string
          kind?: string
          movement_date?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "it_asset_movements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_fixed_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      it_disallowances: {
        Row: {
          amount_paise: number
          company_id: string
          created_at: string
          description: string | null
          fy_end: string
          id: string
          section: string
        }
        Insert: {
          amount_paise?: number
          company_id: string
          created_at?: string
          description?: string | null
          fy_end: string
          id?: string
          section: string
        }
        Update: {
          amount_paise?: number
          company_id?: string
          created_at?: string
          description?: string | null
          fy_end?: string
          id?: string
          section?: string
        }
        Relationships: []
      }
      it_fixed_assets: {
        Row: {
          block_code: string
          company_id: string
          created_at: string
          fy_start: string
          id: string
          is_active: boolean
          ledger_id: string | null
          name: string
          opening_wdv_paise: number
          updated_at: string
        }
        Insert: {
          block_code: string
          company_id: string
          created_at?: string
          fy_start: string
          id?: string
          is_active?: boolean
          ledger_id?: string | null
          name: string
          opening_wdv_paise?: number
          updated_at?: string
        }
        Update: {
          block_code?: string
          company_id?: string
          created_at?: string
          fy_start?: string
          id?: string
          is_active?: boolean
          ledger_id?: string | null
          name?: string
          opening_wdv_paise?: number
          updated_at?: string
        }
        Relationships: []
      }
      items: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          gst_rate: number
          hsn_code: string | null
          id: string
          import_batch_id: string | null
          is_active: boolean
          name: string
          opening_stock_qty: number
          opening_stock_rate_paise: number
          purchase_price_paise: number
          reorder_level: number
          sale_price_paise: number
          unit: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deleted_at?: string | null
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          name: string
          opening_stock_qty?: number
          opening_stock_rate_paise?: number
          purchase_price_paise?: number
          reorder_level?: number
          sale_price_paise?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          name?: string
          opening_stock_qty?: number
          opening_stock_rate_paise?: number
          purchase_price_paise?: number
          reorder_level?: number
          sale_price_paise?: number
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
          {
            foreignKeyName: "items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_group_mappings: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          group_code: string
          id: string
          ledger_type: string
          source_name: string
          source_name_lc: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          group_code: string
          id?: string
          ledger_type: string
          source_name: string
          source_name_lc: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          group_code?: string
          id?: string
          ledger_type?: string
          source_name?: string
          source_name_lc?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_group_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_group_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      ledgers: {
        Row: {
          address: string | null
          company_id: string
          country: string | null
          created_at: string
          credit_days: number
          credit_limit_paise: number
          deleted_at: string | null
          email: string | null
          group_code: string | null
          gst_treatment: Database["public"]["Enums"]["gst_treatment"]
          gstin: string | null
          id: string
          import_batch_id: string | null
          is_active: boolean
          name: string
          opening_balance_is_debit: boolean
          opening_balance_paise: number
          pan: string | null
          phone: string | null
          reminders_enabled: boolean
          state: string | null
          state_code: string | null
          subgroup_id: string | null
          type: Database["public"]["Enums"]["ledger_type"]
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          address?: string | null
          company_id: string
          country?: string | null
          created_at?: string
          credit_days?: number
          credit_limit_paise?: number
          deleted_at?: string | null
          email?: string | null
          group_code?: string | null
          gst_treatment?: Database["public"]["Enums"]["gst_treatment"]
          gstin?: string | null
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          name: string
          opening_balance_is_debit?: boolean
          opening_balance_paise?: number
          pan?: string | null
          phone?: string | null
          reminders_enabled?: boolean
          state?: string | null
          state_code?: string | null
          subgroup_id?: string | null
          type: Database["public"]["Enums"]["ledger_type"]
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          address?: string | null
          company_id?: string
          country?: string | null
          created_at?: string
          credit_days?: number
          credit_limit_paise?: number
          deleted_at?: string | null
          email?: string | null
          group_code?: string | null
          gst_treatment?: Database["public"]["Enums"]["gst_treatment"]
          gstin?: string | null
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          name?: string
          opening_balance_is_debit?: boolean
          opening_balance_paise?: number
          pan?: string | null
          phone?: string | null
          reminders_enabled?: boolean
          state?: string | null
          state_code?: string | null
          subgroup_id?: string | null
          type?: Database["public"]["Enums"]["ledger_type"]
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledgers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledgers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledgers_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "account_subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_balances: {
        Row: {
          closing_paise: number
          company_id: string
          credit_paise: number
          debit_paise: number
          id: string
          ledger_id: string
          opening_paise: number
          period_month: string
          rebuilt_at: string
        }
        Insert: {
          closing_paise?: number
          company_id: string
          credit_paise?: number
          debit_paise?: number
          id?: string
          ledger_id: string
          opening_paise?: number
          period_month: string
          rebuilt_at?: string
        }
        Update: {
          closing_paise?: number
          company_id?: string
          credit_paise?: number
          debit_paise?: number
          id?: string
          ledger_id?: string
          opening_paise?: number
          period_month?: string
          rebuilt_at?: string
        }
        Relationships: []
      }
      payment_reminders: {
        Row: {
          channel: string
          company_id: string
          id: string
          ledger_id: string
          message: string | null
          sent_at: string
          sent_by: string
          status: string
          voucher_id: string | null
        }
        Insert: {
          channel: string
          company_id: string
          id?: string
          ledger_id: string
          message?: string | null
          sent_at?: string
          sent_by: string
          status?: string
          voucher_id?: string | null
        }
        Update: {
          channel?: string
          company_id?: string
          id?: string
          ledger_id?: string
          message?: string | null
          sent_at?: string
          sent_by?: string
          status?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_reminders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reminders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reminders_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reminders_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      period_lock_audit: {
        Row: {
          action: string
          company_id: string
          id: string
          performed_at: string
          performed_by: string
          period: string
          period_lock_id: string | null
          reason: string
          return_type: string
        }
        Insert: {
          action: string
          company_id: string
          id?: string
          performed_at?: string
          performed_by: string
          period: string
          period_lock_id?: string | null
          reason: string
          return_type: string
        }
        Update: {
          action?: string
          company_id?: string
          id?: string
          performed_at?: string
          performed_by?: string
          period?: string
          period_lock_id?: string | null
          reason?: string
          return_type?: string
        }
        Relationships: []
      }
      period_locks: {
        Row: {
          company_id: string
          created_at: string
          filed_reference: string | null
          id: string
          is_active: boolean
          locked_at: string
          locked_by: string
          notes: string | null
          period: string
          period_end: string
          period_start: string
          return_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          filed_reference?: string | null
          id?: string
          is_active?: boolean
          locked_at?: string
          locked_by: string
          notes?: string | null
          period: string
          period_end: string
          period_start: string
          return_type: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          filed_reference?: string | null
          id?: string
          is_active?: boolean
          locked_at?: string
          locked_by?: string
          notes?: string | null
          period?: string
          period_end?: string
          period_start?: string
          return_type?: string
          updated_at?: string
        }
        Relationships: []
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
      recurring_invoices: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          end_date: string | null
          frequency: string
          id: string
          is_active: boolean
          last_generated_at: string | null
          last_generated_voucher_id: string | null
          name: string
          next_run_date: string
          party_ledger_id: string | null
          template_json: Json
          updated_at: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          last_generated_at?: string | null
          last_generated_voucher_id?: string | null
          name: string
          next_run_date: string
          party_ledger_id?: string | null
          template_json?: Json
          updated_at?: string
          voucher_type?: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          last_generated_at?: string | null
          last_generated_voucher_id?: string | null
          name?: string
          next_run_date?: string
          party_ledger_id?: string | null
          template_json?: Json
          updated_at?: string
          voucher_type?: Database["public"]["Enums"]["voucher_type"]
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_last_generated_voucher_id_fkey"
            columns: ["last_generated_voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_party_ledger_id_fkey"
            columns: ["party_ledger_id"]
            isOneToOne: false
            referencedRelation: "ledgers"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_entries: {
        Row: {
          cleared_date: string | null
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
          cleared_date?: string | null
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
          cleared_date?: string | null
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
      voucher_export_details: {
        Row: {
          apeda_rcmc_no: string | null
          buyer_address: string | null
          buyer_country: string | null
          buyer_gstin: string | null
          buyer_name: string | null
          company_id: string
          consignee_address: string | null
          consignee_country: string | null
          consignee_gstin: string | null
          consignee_name: string | null
          container_no: string | null
          country_of_destination: string | null
          country_of_origin: string | null
          created_at: string
          crop_year: string | null
          currency_code: string
          declaration: string | null
          export_type: string
          final_destination: string | null
          fssai_no: string | null
          fx_rate: number
          fx_rate_source: string | null
          gross_weight_kg: number | null
          iec_no: string | null
          igst_refund_claim: boolean
          incoterms: string | null
          kind_of_packages: string | null
          lot_batch_no: string | null
          lut_date: string | null
          lut_no: string | null
          marks_nos: string | null
          moisture_pct: number | null
          net_weight_kg: number | null
          no_of_packages: string | null
          packing_spec: string | null
          payment_terms: string | null
          phyto_cert_no: string | null
          place_of_receipt: string | null
          port_of_discharge: string | null
          port_of_loading: string | null
          pre_carriage_by: string | null
          remarks: string | null
          updated_at: string
          variety_grade: string | null
          vessel_flight_no: string | null
          voucher_id: string
        }
        Insert: {
          apeda_rcmc_no?: string | null
          buyer_address?: string | null
          buyer_country?: string | null
          buyer_gstin?: string | null
          buyer_name?: string | null
          company_id: string
          consignee_address?: string | null
          consignee_country?: string | null
          consignee_gstin?: string | null
          consignee_name?: string | null
          container_no?: string | null
          country_of_destination?: string | null
          country_of_origin?: string | null
          created_at?: string
          crop_year?: string | null
          currency_code?: string
          declaration?: string | null
          export_type?: string
          final_destination?: string | null
          fssai_no?: string | null
          fx_rate?: number
          fx_rate_source?: string | null
          gross_weight_kg?: number | null
          iec_no?: string | null
          igst_refund_claim?: boolean
          incoterms?: string | null
          kind_of_packages?: string | null
          lot_batch_no?: string | null
          lut_date?: string | null
          lut_no?: string | null
          marks_nos?: string | null
          moisture_pct?: number | null
          net_weight_kg?: number | null
          no_of_packages?: string | null
          packing_spec?: string | null
          payment_terms?: string | null
          phyto_cert_no?: string | null
          place_of_receipt?: string | null
          port_of_discharge?: string | null
          port_of_loading?: string | null
          pre_carriage_by?: string | null
          remarks?: string | null
          updated_at?: string
          variety_grade?: string | null
          vessel_flight_no?: string | null
          voucher_id: string
        }
        Update: {
          apeda_rcmc_no?: string | null
          buyer_address?: string | null
          buyer_country?: string | null
          buyer_gstin?: string | null
          buyer_name?: string | null
          company_id?: string
          consignee_address?: string | null
          consignee_country?: string | null
          consignee_gstin?: string | null
          consignee_name?: string | null
          container_no?: string | null
          country_of_destination?: string | null
          country_of_origin?: string | null
          created_at?: string
          crop_year?: string | null
          currency_code?: string
          declaration?: string | null
          export_type?: string
          final_destination?: string | null
          fssai_no?: string | null
          fx_rate?: number
          fx_rate_source?: string | null
          gross_weight_kg?: number | null
          iec_no?: string | null
          igst_refund_claim?: boolean
          incoterms?: string | null
          kind_of_packages?: string | null
          lot_batch_no?: string | null
          lut_date?: string | null
          lut_no?: string | null
          marks_nos?: string | null
          moisture_pct?: number | null
          net_weight_kg?: number | null
          no_of_packages?: string | null
          packing_spec?: string | null
          payment_terms?: string | null
          phyto_cert_no?: string | null
          place_of_receipt?: string | null
          port_of_discharge?: string | null
          port_of_loading?: string | null
          pre_carriage_by?: string | null
          remarks?: string | null
          updated_at?: string
          variety_grade?: string | null
          vessel_flight_no?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_export_details_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_export_details_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_export_details_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: true
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
          role: string
          sgst_paise: number
          specs: Json | null
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
          role?: string
          sgst_paise?: number
          specs?: Json | null
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
          role?: string
          sgst_paise?: number
          specs?: Json | null
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
          {
            foreignKeyName: "voucher_number_seq_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      voucher_repair_audit: {
        Row: {
          action: string
          company_id: string
          created_at: string
          details: Json
          id: string
          performed_by: string | null
          voucher_id: string | null
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          details?: Json
          id?: string
          performed_by?: string | null
          voucher_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          details?: Json
          id?: string
          performed_by?: string | null
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_repair_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_repair_audit_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          cgst_paise: number
          chain_status: string
          company_id: string
          created_at: string
          created_by: string
          deleted_at: string | null
          due_date: string | null
          id: string
          igst_paise: number
          import_batch_id: string | null
          is_amendment: boolean
          is_interstate: boolean
          itc_class: Database["public"]["Enums"]["itc_class"]
          itc_eligible: boolean
          linked_voucher_ids: Json
          narration: string | null
          orig_invoice_date: string | null
          orig_invoice_no: string | null
          orig_period: string | null
          original_voucher_id: string | null
          party_ledger_id: string | null
          place_of_supply_code: string | null
          port_code: string | null
          process_yield_pct: number | null
          processing_overhead_paise: number
          reason: string | null
          reference_no: string | null
          round_off_paise: number
          scrap_value_paise: number
          sgst_paise: number
          shipping_bill_date: string | null
          shipping_bill_no: string | null
          subtotal_paise: number
          supply_nature: Database["public"]["Enums"]["supply_nature"]
          total_paise: number
          updated_at: string
          vendor_invoice_date: string | null
          vendor_invoice_no: string | null
          voucher_date: string
          voucher_number: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Insert: {
          cgst_paise?: number
          chain_status?: string
          company_id: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          due_date?: string | null
          id?: string
          igst_paise?: number
          import_batch_id?: string | null
          is_amendment?: boolean
          is_interstate?: boolean
          itc_class?: Database["public"]["Enums"]["itc_class"]
          itc_eligible?: boolean
          linked_voucher_ids?: Json
          narration?: string | null
          orig_invoice_date?: string | null
          orig_invoice_no?: string | null
          orig_period?: string | null
          original_voucher_id?: string | null
          party_ledger_id?: string | null
          place_of_supply_code?: string | null
          port_code?: string | null
          process_yield_pct?: number | null
          processing_overhead_paise?: number
          reason?: string | null
          reference_no?: string | null
          round_off_paise?: number
          scrap_value_paise?: number
          sgst_paise?: number
          shipping_bill_date?: string | null
          shipping_bill_no?: string | null
          subtotal_paise?: number
          supply_nature?: Database["public"]["Enums"]["supply_nature"]
          total_paise?: number
          updated_at?: string
          vendor_invoice_date?: string | null
          vendor_invoice_no?: string | null
          voucher_date: string
          voucher_number: string
          voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Update: {
          cgst_paise?: number
          chain_status?: string
          company_id?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          due_date?: string | null
          id?: string
          igst_paise?: number
          import_batch_id?: string | null
          is_amendment?: boolean
          is_interstate?: boolean
          itc_class?: Database["public"]["Enums"]["itc_class"]
          itc_eligible?: boolean
          linked_voucher_ids?: Json
          narration?: string | null
          orig_invoice_date?: string | null
          orig_invoice_no?: string | null
          orig_period?: string | null
          original_voucher_id?: string | null
          party_ledger_id?: string | null
          place_of_supply_code?: string | null
          port_code?: string | null
          process_yield_pct?: number | null
          processing_overhead_paise?: number
          reason?: string | null
          reference_no?: string | null
          round_off_paise?: number
          scrap_value_paise?: number
          sgst_paise?: number
          shipping_bill_date?: string | null
          shipping_bill_no?: string | null
          subtotal_paise?: number
          supply_nature?: Database["public"]["Enums"]["supply_nature"]
          total_paise?: number
          updated_at?: string
          vendor_invoice_date?: string | null
          vendor_invoice_no?: string | null
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
            foreignKeyName: "vouchers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_original_voucher_id_fkey"
            columns: ["original_voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
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
      companies_picker: {
        Row: {
          has_password: boolean | null
          id: string | null
          name: string | null
        }
        Insert: {
          has_password?: never
          id?: string | null
          name?: string | null
        }
        Update: {
          has_password?: never
          id?: string | null
          name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _require_admin: {
        Args: { _admin_id: string; _admin_pin: string }
        Returns: undefined
      }
      _require_admin_password: {
        Args: { _admin_id: string; _admin_password: string }
        Returns: undefined
      }
      _validate_pin: { Args: { _pin: string }; Returns: undefined }
      accounts_exist: { Args: never; Returns: boolean }
      app_users_count: { Args: never; Returns: number }
      can_write_company: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      change_account_password: {
        Args: { _new_password: string; _old_password: string; _user_id: string }
        Returns: undefined
      }
      create_app_user: {
        Args: {
          _admin_id: string
          _admin_pin: string
          _name: string
          _pin: string
          _role: Database["public"]["Enums"]["app_user_role"]
        }
        Returns: string
      }
      delete_account_admin: {
        Args: { _admin_id: string; _admin_password: string; _target_id: string }
        Returns: undefined
      }
      delete_app_user: {
        Args: { _admin_id: string; _admin_pin: string; _target_id: string }
        Returns: undefined
      }
      delete_import_batch: { Args: { _batch_id: string }; Returns: Json }
      delete_vouchers_bulk: {
        Args: {
          _company_id: string
          _from_date?: string
          _to_date?: string
          _voucher_type: Database["public"]["Enums"]["voucher_type"]
        }
        Returns: number
      }
      enforce_item_header_totals: {
        Args: { _vids: string[] }
        Returns: undefined
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
      is_period_locked: {
        Args: { _company_id: string; _date: string }
        Returns: boolean
      }
      list_accounts_admin: {
        Args: { _admin_id: string; _admin_password: string }
        Returns: {
          created_at: string
          hide_from_picker: boolean
          id: string
          is_active: boolean
          name: string
          role: Database["public"]["Enums"]["app_user_role"]
          username: string
        }[]
      }
      list_login_users: {
        Args: never
        Returns: {
          id: string
          name: string
          role: Database["public"]["Enums"]["app_user_role"]
          username: string
        }[]
      }
      lock_period: {
        Args: {
          _company_id: string
          _filed_reference?: string
          _notes?: string
          _period: string
          _period_end: string
          _period_start: string
          _return_type: string
        }
        Returns: string
      }
      next_voucher_number: {
        Args: {
          _company_id: string
          _type: Database["public"]["Enums"]["voucher_type"]
        }
        Returns: string
      }
      reclassify_misposted_vouchers: {
        Args: { _company_id: string }
        Returns: Json
      }
      recompute_monthly_balances: {
        Args: { _company_id: string }
        Returns: number
      }
      repair_orphan_vouchers_with_suspense: {
        Args: { _company_id: string }
        Returns: Json
      }
      reset_app_user_pin: {
        Args: {
          _admin_id: string
          _admin_pin: string
          _new_pin: string
          _target_id: string
        }
        Returns: undefined
      }
      save_voucher_atomic: {
        Args: { _entries?: Json; _header: Json; _items?: Json }
        Returns: string
      }
      set_company_password: {
        Args: { _company_id: string; _new_password: string }
        Returns: undefined
      }
      setup_first_account:
        | {
            Args: { _name: string; _password: string; _username: string }
            Returns: string
          }
        | {
            Args: {
              _hide_from_picker?: boolean
              _name: string
              _password: string
              _username: string
            }
            Returns: string
          }
      setup_first_admin: {
        Args: { _name: string; _pin: string }
        Returns: string
      }
      signup_account:
        | {
            Args: { _name: string; _password: string; _username: string }
            Returns: string
          }
        | {
            Args: {
              _hide_from_picker?: boolean
              _name: string
              _password: string
              _username: string
            }
            Returns: string
          }
      sync_opening_balances_from_previous_fy: {
        Args: { _company_id: string; _fy_start: string }
        Returns: Json
      }
      unlock_period: {
        Args: {
          _company_id: string
          _period: string
          _reason: string
          _return_type: string
        }
        Returns: undefined
      }
      update_account_admin: {
        Args: {
          _admin_id: string
          _admin_password: string
          _hide_from_picker: boolean
          _is_active: boolean
          _new_name: string
          _new_password?: string
          _new_role: Database["public"]["Enums"]["app_user_role"]
          _target_id: string
        }
        Returns: undefined
      }
      verify_account_login: {
        Args: { _password: string; _username: string }
        Returns: {
          id: string
          name: string
          role: Database["public"]["Enums"]["app_user_role"]
        }[]
      }
      verify_app_user_pin: {
        Args: { _pin: string; _user_id: string }
        Returns: boolean
      }
      verify_company_password: {
        Args: { _attempt: string; _company_id: string }
        Returns: boolean
      }
      voucher_company_id: { Args: { _voucher_id: string }; Returns: string }
    }
    Enums: {
      app_user_role: "admin" | "staff"
      company_role: "admin" | "accountant" | "viewer"
      entity_status:
        | "individual"
        | "huf"
        | "aop"
        | "pvt_ltd"
        | "registered_firm"
        | "trust"
      gst_treatment:
        | "regular"
        | "composition"
        | "unregistered"
        | "consumer"
        | "sez_with_payment"
        | "sez_without_payment"
        | "overseas"
        | "deemed_export"
        | "uin_holder"
      itc_class:
        | "inputs"
        | "capital_goods"
        | "input_services"
        | "ineligible"
        | "na"
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
      supply_nature:
        | "taxable"
        | "zero_rated_wp"
        | "zero_rated_wop"
        | "nil_rated"
        | "exempt"
        | "non_gst"
        | "rcm_inward"
        | "deemed_export"
      voucher_type:
        | "sales"
        | "purchase"
        | "receipt"
        | "payment"
        | "journal"
        | "contra"
        | "credit_note"
        | "debit_note"
        | "quotation"
        | "sales_order"
        | "delivery_note"
        | "manufacturing"
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
      app_user_role: ["admin", "staff"],
      company_role: ["admin", "accountant", "viewer"],
      entity_status: [
        "individual",
        "huf",
        "aop",
        "pvt_ltd",
        "registered_firm",
        "trust",
      ],
      gst_treatment: [
        "regular",
        "composition",
        "unregistered",
        "consumer",
        "sez_with_payment",
        "sez_without_payment",
        "overseas",
        "deemed_export",
        "uin_holder",
      ],
      itc_class: [
        "inputs",
        "capital_goods",
        "input_services",
        "ineligible",
        "na",
      ],
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
      supply_nature: [
        "taxable",
        "zero_rated_wp",
        "zero_rated_wop",
        "nil_rated",
        "exempt",
        "non_gst",
        "rcm_inward",
        "deemed_export",
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
        "quotation",
        "sales_order",
        "delivery_note",
        "manufacturing",
      ],
    },
  },
} as const
