import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// These are public keys, safe for the client
const supabaseUrl = 'https://tpjiowcovqfvmuockpop.supabase.co';
const supabaseKey = 'sb_publishable_oPVDWjhvI6wHSlN-DqykyQ_1BMrj5_G';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  get client() {
    return this.supabase;
  }
}
