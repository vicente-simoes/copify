import {describe,expect,it} from "vitest";
import {estimateCostMicrosUsd,resolveBudgetPeriod,resolveCostPeriod,resolveCostSeries} from "./costs";

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
  it("buckets the spend series by span and covers the whole period",()=>{
    const start=Date.parse("2026-08-27T09:30:00Z");
    const hourly=resolveCostSeries(start,start+5*3_600_000,"Europe/Lisbon");
    expect(hourly.granularity).toBe("HOUR");
    expect(new Date(hourly.edges[0]!).toISOString()).toBe("2026-08-27T09:00:00.000Z");
    expect(hourly.edges).toHaveLength(7);
    const daily=resolveCostSeries(start,start+9*86_400_000,"Europe/Lisbon");
    expect(daily.granularity).toBe("DAY");
    expect(daily.edges).toHaveLength(11);
    const weekly=resolveCostSeries(start,start+400*86_400_000,"Europe/Lisbon");
    expect(weekly.granularity).toBe("WEEK");
    // Week edges land on Monday local midnight, and the last edge covers the end.
    expect(new Date(weekly.edges[0]!).toISOString()).toBe("2026-08-23T23:00:00.000Z");
    expect(weekly.edges[weekly.edges.length-1]!).toBeGreaterThanOrEqual(start+400*86_400_000);
    for(const plan of [hourly,daily,weekly]){
      expect(plan.edges[0]!).toBeLessThanOrEqual(start);
      expect(plan.edges.every((edge,index)=>index===0||edge>plan.edges[index-1]!)).toBe(true);
      expect(plan.edges.length-1).toBeLessThanOrEqual(400);
    }
  });
});
