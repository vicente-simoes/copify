import {describe,expect,it} from "vitest";
import {estimateCostMicrosUsd,resolveBudgetPeriod,resolveCostPeriod} from "./costs";

describe("cost accounting contracts",()=>{
  it("uses BigInt floor arithmetic and leaves unsupported estimates unavailable",()=>{
    expect(estimateCostMicrosUsd(999_999_999,0,1_000_000)).toBe(999_999);
    expect(estimateCostMicrosUsd(10,20,null)).toBeNull();
    expect(estimateCostMicrosUsd(10,20,1_000_000,false)).toBeNull();
    expect(estimateCostMicrosUsd(Number.MAX_SAFE_INTEGER-1,0,1)).toBe(9_007_199);
  });
  it("uses Lisbon local calendar boundaries across DST and Monday weeks",()=>{
    const beforeDst=Date.parse("2026-03-29T12:00:00Z");const today=resolveCostPeriod({preset:"TODAY",startAt:null,endAt:null,timezoneId:"Europe/Lisbon"},beforeDst);
    expect(new Date(today.startAt).toISOString()).toBe("2026-03-29T00:00:00.000Z");
    const daily=resolveBudgetPeriod("DAILY","Europe/Lisbon",beforeDst);expect(daily.endAt-daily.startAt).toBe(23*3_600_000);
    const weekly=resolveBudgetPeriod("WEEKLY","Europe/Lisbon",Date.parse("2026-08-26T12:00:00Z"));expect(new Date(weekly.startAt).toISOString()).toBe("2026-08-23T23:00:00.000Z");
  });
});
