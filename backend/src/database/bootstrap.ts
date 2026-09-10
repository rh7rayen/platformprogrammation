import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadConfig } from '../config';
import { Database } from './database';

// One-time operator command. Credentials are environment variables, never CLI arguments.
async function main() {
  const config = loadConfig({ APP_MODE:'supabase' });
  const input = z.object({ BOOTSTRAP_EMAIL:z.email(), BOOTSTRAP_PASSWORD:z.string().min(16), BOOTSTRAP_NAME:z.string().min(2), BOOTSTRAP_UNIVERSITY:z.string().min(2), BOOTSTRAP_CODE:z.string().min(2), SUPABASE_SECRET_KEY:z.string().min(20) }).parse(process.env);
  const supabase=createClient(config.SUPABASE_URL,input.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const database=new Database(config);
  try {
    await database.connect();
    // Refuse an existing university before creating any external account.
    const exists=await database.privileged(c=>c.query('select id from public.universities where code=$1',[input.BOOTSTRAP_CODE]));
    if(exists.rows.length) throw new Error('University already exists.');
    const {data,error}=await supabase.auth.admin.createUser({email:input.BOOTSTRAP_EMAIL,password:input.BOOTSTRAP_PASSWORD,email_confirm:true});
    if(error || !data.user) throw new Error('Account creation failed.');
    try {
      await database.privileged(async c=>{
        const result=await c.query<{id:string}>('insert into public.universities(name,code) values($1,$2) returning id',[input.BOOTSTRAP_UNIVERSITY,input.BOOTSTRAP_CODE]);
        const u=result.rows[0].id;
        await c.query('insert into public.profiles(id,full_name,email) values($1,$2,$3)',[data.user.id,input.BOOTSTRAP_NAME,input.BOOTSTRAP_EMAIL]);
        await c.query('insert into public.university_memberships(university_id,user_id) values($1,$2)',[u,data.user.id]);
        await c.query("insert into public.role_assignments(university_id,user_id,role) values($1,$2,'UNIVERSITY_ADMIN')",[u,data.user.id]);
      });
    } catch(error) {
      const cleanup=await supabase.auth.admin.deleteUser(data.user.id);
      if(cleanup.error) console.error('Account rollback failed. Operator reconciliation required in Supabase Auth.');
      throw error;
    }
    console.log('University and administrator created. Sign in through the application.');
  } finally { await database.close(); }
}
main().catch(()=>{console.error('Bootstrap failed. Check configuration or existing records; no secrets are logged.');process.exitCode=1;});
