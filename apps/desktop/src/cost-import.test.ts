import {describe,expect,it} from "vitest";
import {inferProviderMapping,normalizeImportRows} from "./cost-import";

describe("provider CSV normalization",()=>{
  it("detects common DataImpulse columns and converts decimal GB and USD",()=>{
    const headers=["Date","Traffic","Requests","Money spent","Plan"];const mapping=inferProviderMapping(headers);expect(mapping).not.toBeNull();
    const result=normalizeImportRows(headers,[["2026-08-25","1.25","12","0.75","Residential"]],{...mapping!,trafficUnit:"GB"});
    expect(result).toEqual({rejected:0,records:[expect.objectContaining({receivedBytes:1_250_000_000,requestCount:12,billedCostMicrosUsd:750_000,planLabel:"Residential"})]});
  });
  it("rejects malformed rows without returning raw contents",()=>{const result=normalizeImportRows(["Date","Cost"],[["not-a-date","secret-url"]],{timestampColumn:"Date",endTimestampColumn:null,trafficColumn:null,trafficUnit:"MB",requestCountColumn:null,costColumn:"Cost",planColumn:null});expect(result).toEqual({records:[],rejected:1});});
});
