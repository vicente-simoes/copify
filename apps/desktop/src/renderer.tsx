import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BrowserProfile, SessionSnapshot } from "@copify/shared";
import "./styles.css";

type Notice = { kind: "error" | "info"; message: string } | null;

function App() {
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [sessions, setSessions] = useState<Record<string, SessionSnapshot>>({});
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const reload = async (): Promise<void> => {
    const [profileResult, sessionResult] = await Promise.all([window.copify.profiles.list(), window.copify.sessions.list()]);
    if (!profileResult.ok) return setNotice({ kind: "error", message: profileResult.error });
    setProfiles(profileResult.value);
    if (sessionResult.ok) setSessions(Object.fromEntries(sessionResult.value.map((session) => [session.profileId, session])));
  };

  useEffect(() => {
    void reload();
    return window.copify.sessions.onChanged((snapshot) => setSessions((current) => ({ ...current, [snapshot.profileId]: snapshot })));
  }, []);

  const activeCount = useMemo(() => Object.values(sessions).filter((session) => ["STARTING", "READY", "STOPPING"].includes(session.state)).length, [sessions]);
  const execute = async (operation: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    setBusy(true); setNotice(null);
    try { const response = await operation(); if (!response.ok) setNotice({ kind: "error", message: response.error ?? "Operation failed." }); }
    finally { setBusy(false); await reload(); }
  };
  const addProfile = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    await execute(async () => {
      const response = await window.copify.profiles.create({ name });
      if (response.ok) { setName(""); setNotice({ kind: "info", message: "Browser profile created." }); }
      return response;
    });
  };
  const toggle = (profile: BrowserProfile) => execute(() => window.copify.profiles.update(profile.id, { enabled: !profile.enabled }));
  const rename = (profile: BrowserProfile) => {
    const nextName = window.prompt("Profile name", profile.name)?.trim();
    if (nextName && nextName !== profile.name) void execute(() => window.copify.profiles.update(profile.id, { name: nextName }));
  };
  const remove = (profile: BrowserProfile) => {
    if (window.confirm(`Remove “${profile.name}” from Copify? Its Chrome data will stay on disk.`)) void execute(() => window.copify.profiles.remove(profile.id));
  };

  return <main>
    <header><div><p className="eyebrow">COPIFY / V0.1</p><h1>Browser operations console</h1></div><div className="summary"><strong>{activeCount}</strong> active sessions</div></header>
    <section className="toolbar"><button disabled={busy || profiles.filter((p) => p.enabled).length === 0} onClick={() => void execute(() => window.copify.sessions.openAll())}>Open all</button><button className="secondary" disabled={busy || activeCount === 0} onClick={() => void execute(() => window.copify.sessions.closeAll())}>Close all</button></section>
    {notice && <p className={`notice ${notice.kind}`}>{notice.message}</p>}
    <section className="new-profile"><h2>Browser profiles</h2><form onSubmit={(event) => void addProfile(event)}><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Home session" aria-label="Profile name" /><button disabled={busy || !name.trim()} type="submit">Add profile</button></form></section>
    <section className="profiles" aria-label="Browser profiles">
      {profiles.length === 0 && <div className="empty">Create a profile to launch its isolated, persistent Chrome session.</div>}
      {profiles.map((profile) => {
        const session = sessions[profile.id] ?? { profileId: profile.id, state: "STOPPED" as const, error: null, updatedAt: 0 };
        const active = ["STARTING", "READY", "STOPPING"].includes(session.state);
        return <article key={profile.id} className="profile-card"><div className="profile-title"><div><h3>{profile.name}</h3><p>{profile.enabled ? "Enabled" : "Disabled"} · Persistent Chrome profile</p></div><span className={`state ${session.state.toLowerCase()}`}>{session.state}</span></div>
          {session.error && <p className="error-detail">{session.error.code}: {session.error.message}</p>}
          <div className="actions"><button disabled={busy || !profile.enabled || active} onClick={() => void execute(() => window.copify.sessions.open(profile.id))}>Open</button><button className="secondary" disabled={busy || !active} onClick={() => void execute(() => window.copify.sessions.close(profile.id))}>Close</button><button className="secondary" disabled={busy || !profile.enabled || session.state === "STARTING" || session.state === "STOPPING"} onClick={() => void execute(() => window.copify.sessions.restart(profile.id))}>Restart</button><button className="text" disabled={busy || active} onClick={() => rename(profile)}>Rename</button><button className="text" disabled={busy || active} onClick={() => void toggle(profile)}>{profile.enabled ? "Disable" : "Enable"}</button><button className="danger" disabled={busy || active} onClick={() => remove(profile)}>Remove</button></div>
        </article>;
      })}
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
