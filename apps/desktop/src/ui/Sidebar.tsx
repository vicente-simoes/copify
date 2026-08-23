import { NetworkIcon, RunsIcon, SessionsIcon, SettingsIcon, ShippingIcon, TargetsIcon } from "./icons";

export type Workspace =
  | "overview"
  | "runs"
  | "targets"
  | "profiles"
  | "shipping"
  | "network";

type NavEntry = { id: Workspace; label: string; Icon: (props: { className?: string }) => React.JSX.Element };

// Labels carry the whole meaning; the pre-redesign captions repeated them.
export const navigation: NavEntry[] = [
  { id: "overview", label: "Overview", Icon: SessionsIcon },
  { id: "profiles", label: "Profiles", Icon: SessionsIcon },
  { id: "targets", label: "Targets", Icon: TargetsIcon },
  { id: "shipping", label: "Shipping", Icon: ShippingIcon },
  { id: "runs", label: "Runs", Icon: RunsIcon },
];

const footerNavigation: NavEntry[] = [{ id: "network", label: "Network", Icon: NetworkIcon }];

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

export { SettingsIcon };
