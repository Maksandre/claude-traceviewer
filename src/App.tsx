import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ConversationView } from "./components/ConversationView";
import type { SessionInfo, TraceRecord } from "./types";
import "./App.css";

function App() {
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [records, setRecords] = useState<TraceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects);
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    fetch(`/api/projects/${encodeURIComponent(selectedProject)}/sessions`)
      .then((r) => r.json())
      .then(setSessions);
  }, [selectedProject]);

  const fetchSession = useCallback(() => {
    if (!selectedProject || !selectedSession) return;
    fetch(
      `/api/projects/${encodeURIComponent(selectedProject)}/sessions/${encodeURIComponent(selectedSession)}`
    )
      .then((r) => r.json())
      .then((data) => {
        setRecords(data);
        setLoading(false);
      });
  }, [selectedProject, selectedSession]);

  useEffect(() => {
    setLoading(true);
    fetchSession();
  }, [fetchSession]);

  // Auto-refresh every 5s when a session is open
  useEffect(() => {
    if (!selectedProject || !selectedSession) return;
    const interval = setInterval(fetchSession, 5000);
    return () => clearInterval(interval);
  }, [selectedProject, selectedSession, fetchSession]);

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={(p) => {
          setSelectedProject(p);
          setSelectedSession(null);
          setRecords([]);
        }}
        sessions={sessions}
        selectedSession={selectedSession}
        onSelectSession={setSelectedSession}
        onDeleteSession={(id) => {
          fetch(
            `/api/projects/${encodeURIComponent(selectedProject!)}/sessions/${encodeURIComponent(id)}`,
            { method: "DELETE" }
          ).then(() => {
            setSessions((s) => s.filter((x) => x.id !== id));
            if (selectedSession === id) {
              setSelectedSession(null);
              setRecords([]);
            }
          });
        }}
        onDeleteAllSessions={() => {
          fetch(
            `/api/projects/${encodeURIComponent(selectedProject!)}/sessions`,
            { method: "DELETE" }
          ).then(() => {
            setSessions([]);
            setSelectedSession(null);
            setRecords([]);
          });
        }}
      />
      <main className="main">
        {records.length > 0 && (
          <div className="main-toolbar">
            <button className="refresh-btn" onClick={fetchSession}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
              Refresh
            </button>
            <span className="record-count">{records.length} records</span>
          </div>
        )}
        {loading && records.length === 0 ? (
          <div className="empty">Loading...</div>
        ) : records.length > 0 ? (
          <ConversationView
            records={records}
            project={selectedProject!}
            session={selectedSession!}
          />
        ) : (
          <div className="empty">Select a session to view</div>
        )}
      </main>
    </div>
  );
}

export default App;
