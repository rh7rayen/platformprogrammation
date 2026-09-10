import { Inject, Injectable, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from '../auth/auth.service';
import type { AppConfig } from '../config';

export const MAX_RECORDING_CHUNK_BYTES=4*1024*1024;
export const RECORDING_MIME_TYPES=['video/webm','video/mp4'];
export interface RecordingObject {size:number;mimeType:string}

@Injectable()
export class RecordingStorage {
  private client?:SupabaseClient;
  private checkedAt=0;
  constructor(@Inject(CONFIG) private readonly config:AppConfig) {}
  get configured(){return this.config.RECORDINGS_ENABLED==='true' && Boolean(this.config.SUPABASE_URL && this.config.SUPABASE_SERVICE_ROLE_KEY);}
  get retentionDays(){return this.config.RECORDINGS_RETENTION_DAYS;}
  private sdk(){
    if(!this.configured)throw new ServiceUnavailableException('Enregistrement indisponible : stockage vidéo privé non configuré.');
    return this.client??=createClient(this.config.SUPABASE_URL,this.config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})}});
  }
  async ready(){
    const client=this.sdk();
    if(Date.now()-this.checkedAt<60000)return;
    const {data,error}=await client.storage.getBucket(this.config.RECORDINGS_BUCKET);
    if(error || !data)throw new ServiceUnavailableException('Le bucket vidéo privé est inaccessible.');
    if(data.public || !data.file_size_limit || data.file_size_limit>MAX_RECORDING_CHUNK_BYTES || !data.allowed_mime_types?.length || data.allowed_mime_types.some(m=>!RECORDING_MIME_TYPES.includes(m)))
      throw new ServiceUnavailableException('Le bucket vidéo doit être privé, limité à 4 Mio par fichier et aux types video/webm ou video/mp4.');
    this.checkedAt=Date.now();
  }
  async uploadUrl(path:string){
    await this.ready();
    const {data,error}=await this.sdk().storage.from(this.config.RECORDINGS_BUCKET).createSignedUploadUrl(path,{upsert:false});
    if(error || !data)throw new ServiceUnavailableException('Impossible de préparer le transfert vidéo.');
    return data.signedUrl;
  }
  async info(path:string):Promise<RecordingObject>{
    await this.ready();
    const {data,error}=await this.sdk().storage.from(this.config.RECORDINGS_BUCKET).info(path);
    if(error || !data)throw new ConflictException('Le segment vidéo n’est pas encore reçu dans le stockage.');
    return {size:Number(data.size),mimeType:String(data.contentType).split(';')[0].toLowerCase()};
  }
  async playUrl(path:string){
    await this.ready();
    const {data,error}=await this.sdk().storage.from(this.config.RECORDINGS_BUCKET).createSignedUrl(path,120);
    if(error || !data)throw new ServiceUnavailableException('Impossible d’ouvrir ce segment vidéo.');
    return data.signedUrl;
  }
  async remove(paths:string[]){
    if(!paths.length)return;
    await this.ready();
    const {error}=await this.sdk().storage.from(this.config.RECORDINGS_BUCKET).remove(paths);
    if(error)throw new ServiceUnavailableException('Suppression vidéo à réessayer.');
  }
}
