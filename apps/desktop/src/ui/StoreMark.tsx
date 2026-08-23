import { getStoreManifest } from "@copify/shared";

// Brand marks are keyed by store id, so adding a boutique is dropping
// resources/brands/<storeId>.svg in place — no renderer change. Stores without
// a mark fall back to their name, which is expected to be the rare case.
const marks = import.meta.glob("../../resources/brands/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byStoreId = new Map(
  Object.entries(marks).map(([path, url]) => [path.split("/").pop()!.replace(/\.svg$/, ""), url]),
);

export function StoreMark({ storeId, className }: { storeId: string; className?: string }) {
  const name = getStoreManifest(storeId)?.name ?? storeId;
  const source = byStoreId.get(storeId);
  if (!source) return <span className={`store-mark store-mark-text ${className ?? ""}`}>{name}</span>;
  return <img className={`store-mark ${className ?? ""}`} src={source} alt={name} title={name} />;
}
