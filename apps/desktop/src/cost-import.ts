import { createHash, randomUUID } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import type { ProviderImportMapping, ProviderImportPreview } from "@copify/shared";
import type { ProviderImportRecord } from "@copify/persistence";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 250_000;
const TOKEN_TTL_MS = 10 * 60_000;
type Pending = { provider:string; headers:string[]; rows:string[][]; expiresAt:number };

function sanitizedHeader(value:string,index:number):string {
  const clean=value.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,120);
  return clean||`Column ${index+1}`;
}
function uniqueHeaders(values:string[]):string[] {
  const seen=new Map<string,number>();
  return values.map((value)=>{const count=(seen.get(value)??0)+1;seen.set(value,count);return count===1?value:`${value} (${count})`;});
}
function normalizedHeader(value:string):string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,""); }
function inferHeader(header:string):"DATE"|"NUMBER"|"TEXT"|"UNKNOWN" { const key=normalizedHeader(header); if(/date|time|period|timestamp/.test(key)) return "DATE"; if(/traffic|bytes|requests|cost|money|spent|amount/.test(key)) return "NUMBER"; return key?"TEXT":"UNKNOWN"; }
function pick(headers:string[],pattern:RegExp):string|null { return headers.find((header)=>pattern.test(normalizedHeader(header)))??null; }
export function inferProviderMapping(headers:string[]):ProviderImportMapping|null {
  const timestampColumn=pick(headers,/^(date|timestamp|period_start|start_date|from)$/)??pick(headers,/date|time|period/); if(!timestampColumn) return null;
  const mapping={timestampColumn,endTimestampColumn:pick(headers,/end|to_date|period_end/),trafficColumn:pick(headers,/traffic|bytes|bandwidth|data_used/),trafficUnit:"MB" as const,requestCountColumn:pick(headers,/request/),costColumn:pick(headers,/cost|money|spent|amount|charge/),planColumn:pick(headers,/plan|package/)};
  return mapping.trafficColumn||mapping.requestCountColumn||mapping.costColumn?mapping:null;
}
function parseNumber(value:string):number|null { const clean=value.trim().replace(/[$€£\s]/g,""); if(!clean)return null; const normalized=clean.includes(",")&&!clean.includes(".")?clean.replace(",","."):clean.replace(/,/g,""); const number=Number(normalized); return Number.isFinite(number)&&number>=0?number:null; }
function trafficBytes(value:string,unit:ProviderImportMapping["trafficUnit"]):number|null { const number=parseNumber(value); if(number===null)return null; const multiplier={BYTES:1,KB:1_000,MB:1_000_000,GB:1_000_000_000}[unit]; const bytes=Math.round(number*multiplier); return Number.isSafeInteger(bytes)?bytes:null; }
function timestamp(value:string):number|null { const parsed=Date.parse(value.trim()); return Number.isFinite(parsed)&&parsed>=0?parsed:null; }

export function normalizeImportRows(headers:string[],rows:string[][],mapping:ProviderImportMapping):{records:ProviderImportRecord[];rejected:number} {
  const index=(name:string|null)=>name===null?-1:headers.indexOf(name); const startIndex=index(mapping.timestampColumn); const endIndex=index(mapping.endTimestampColumn); const trafficIndex=index(mapping.trafficColumn); const requestIndex=index(mapping.requestCountColumn); const costIndex=index(mapping.costColumn); const planIndex=index(mapping.planColumn);
  const records:ProviderImportRecord[]=[]; let rejected=0;
  for(const row of rows){ const start=startIndex>=0?timestamp(row[startIndex]??""):null; if(start===null){rejected++;continue;} const explicitEnd=endIndex>=0?timestamp(row[endIndex]??""):null; const end=explicitEnd&&explicitEnd>start?explicitEnd:start+86_400_000; const receivedBytes=trafficIndex>=0?trafficBytes(row[trafficIndex]??"",mapping.trafficUnit):null; const requestCount=requestIndex>=0?parseNumber(row[requestIndex]??""):null; const billed=costIndex>=0?parseNumber(row[costIndex]??""):null;
    if(receivedBytes===null&&requestCount===null&&billed===null){rejected++;continue;} records.push({provider:"",intervalStartAt:start,intervalEndAt:end,receivedBytes,requestCount:requestCount===null?null:Math.round(requestCount),billedCostMicrosUsd:billed===null?null:Math.floor(billed*1_000_000),planLabel:planIndex>=0?(row[planIndex]?.trim().slice(0,120)||null):null}); }
  return {records,rejected};
}

async function parseCsv(path:string):Promise<{headers:string[];rows:string[][]}>{
  if(statSync(path).size>MAX_BYTES) throw new Error("CSV files are limited to 25 MB.");
  const rows:string[][]=[]; let row:string[]=[]; let field=""; let quoted=false; let pendingQuote=false; let bytes=0;
  const pushField=()=>{row.push(field);field="";}; const pushRow=()=>{pushField(); if(row.some((value)=>value.length)){rows.push(row);if(rows.length>MAX_ROWS+1)throw new Error("CSV files are limited to 250,000 data rows.");} row=[];};
  for await (const chunk of createReadStream(path,{encoding:"utf8"})){ bytes+=Buffer.byteLength(chunk); if(bytes>MAX_BYTES)throw new Error("CSV files are limited to 25 MB."); for(const character of chunk){
    if(pendingQuote){ if(character==='"'){field+='"';pendingQuote=false;continue;} quoted=false;pendingQuote=false; }
    if(quoted){ if(character==='"')pendingQuote=true; else field+=character; continue; }
    if(character==='"'&&field.length===0){quoted=true;continue;} if(character===","){pushField();continue;} if(character==="\n"){pushRow();continue;} if(character!=="\r")field+=character;
  }} if(pendingQuote)quoted=false; if(quoted)throw new Error("The CSV contains an unterminated quoted field."); if(field.length||row.length)pushRow(); if(rows.length<2)throw new Error("The CSV has no data rows."); return {headers:rows[0].map((value)=>value.trim()),rows:rows.slice(1)};
}

export class ProviderImportCoordinator {
  private readonly pending=new Map<string,Pending>();
  async open(provider:string,path:string):Promise<ProviderImportPreview>{ let parsed:{headers:string[];rows:string[][]};try{parsed=await parseCsv(path);}catch(error){if(error instanceof Error&&(error.message.startsWith("CSV files")||error.message.startsWith("The CSV")))throw error;throw new Error("The selected CSV could not be read.");} const token=randomUUID(); const expiresAt=Date.now()+TOKEN_TTL_MS; const headers=uniqueHeaders(parsed.headers.map(sanitizedHeader)); this.pending.set(token,{provider,headers,rows:parsed.rows,expiresAt}); const expiry=setTimeout(()=>this.pending.delete(token),TOKEN_TTL_MS); expiry.unref(); return this.preview(token); }
  preview(token:string,mapping?:ProviderImportMapping):ProviderImportPreview { const pending=this.require(token); const selected=mapping??inferProviderMapping(pending.headers); const normalized=selected?normalizeImportRows(pending.headers,pending.rows,selected):{records:[],rejected:0}; const spendRowCount=normalized.records.filter((row)=>row.billedCostMicrosUsd!==null).length; const warnings=selected?(selected.costColumn===null?["No spend column is mapped. This import can reconcile traffic and requests, but cannot update Confirmed spend."]:spendRowCount===0?["The mapped spend column contains no valid monetary values. Confirmed spend will remain unavailable."]:[]):["Map a date column and at least one usage, request, or cost column."]; return {token,expiresAt:pending.expiresAt,provider:pending.provider,headers:pending.headers.map((label,index)=>({id:String(index),label,inferredType:inferHeader(label)})),mapping:selected,rows:normalized.records.slice(0,20).map((row)=>({intervalStartAt:row.intervalStartAt,intervalEndAt:row.intervalEndAt,usedBytes:row.receivedBytes,requestCount:row.requestCount,billedCostMicrosUsd:row.billedCostMicrosUsd,planLabel:row.planLabel})),totalRows:pending.rows.length,rejectedRows:normalized.rejected,spendRowCount,warnings}; }
  commit(token:string,mapping:ProviderImportMapping):{provider:string;records:ProviderImportRecord[];rejected:number;digest:string}{ const pending=this.require(token); const normalized=normalizeImportRows(pending.headers,pending.rows,mapping); if(!normalized.records.length)throw new Error("No valid provider usage rows were found."); const records=normalized.records.map((row)=>({...row,provider:pending.provider})); const canonical=[...records].sort((a,b)=>a.intervalStartAt-b.intervalStartAt||a.intervalEndAt-b.intervalEndAt).map((row)=>JSON.stringify(row)).join("\n"); const digest=createHash("sha256").update(pending.provider).update("\n").update(canonical).digest("hex"); this.pending.delete(token); return {provider:pending.provider,records,rejected:normalized.rejected,digest}; }
  cancel(token:string):boolean{return this.pending.delete(token);}
  private require(token:string):Pending { const value=this.pending.get(token); if(!value)throw new Error("The import token is invalid or has expired."); if(value.expiresAt<Date.now()){this.pending.delete(token);throw new Error("The import token has expired.");} return value; }
}
