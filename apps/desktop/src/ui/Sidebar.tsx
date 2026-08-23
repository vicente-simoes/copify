import { RunsIcon, SessionsIcon, SettingsIcon, ShippingIcon, TargetsIcon } from "./icons";

export type Workspace = "run" | "browsers" | "targets" | "shipping" | "settings";

type NavEntry = { id: Workspace; label: string; Icon: (props: { className?: string }) => React.JSX.Element };

// Ordered by the drop workflow: you run from the top item and prepare below it.
export const navigation: NavEntry[] = [
  { id: "run", label: "Run", Icon: RunsIcon },
  { id: "browsers", label: "Browsers", Icon: SessionsIcon },
  { id: "targets", label: "Targets", Icon: TargetsIcon },
  { id: "shipping", label: "Shipping", Icon: ShippingIcon },
];

const footerNavigation: NavEntry[] = [{ id: "settings", label: "Settings", Icon: SettingsIcon }];

// Lookup must span both groups, or a footer section resolves to no page.
export const allNavigation: NavEntry[] = [...navigation, ...footerNavigation];

export function Sidebar({
  workspace,
  onNavigate,
}: {
  workspace: Workspace;
  onNavigate: (page: Workspace) => void;
}) {
  const item = ({ id, label, Icon }: NavEntry) => (
    <button
      key={id}
      className={`nav-item ${workspace === id ? "active" : ""}`}
      aria-current={workspace === id ? "page" : undefined}
      onClick={() => onNavigate(id)}
    >
      <Icon className="nav-icon" />
      <span>{label}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="Copify sections">
        {navigation.map(item)}
      </nav>
      <span className="sidebar-spacer" />
      <div className="sidebar-footer">{footerNavigation.map(item)}</div>
    </aside>
  );
}
