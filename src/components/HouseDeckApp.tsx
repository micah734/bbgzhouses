"use client";

import Image from "next/image";
import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  HouseName,
  Student,
  Transaction,
  houseStyles,
  students as seedStudents,
  transactions as seedTransactions,
} from "@/lib/sample-data";
import {
  SupabaseInvite,
  SupabaseProfile,
  SupabaseRole,
  SupabaseSession,
  archiveSupabaseTerm,
  awardSupabasePoints,
  createTeacherInvite,
  createSupabaseStudent,
  ensureProfile,
  getStoredSession,
  importSupabaseStudents,
  isSupabaseConfigured,
  loadHouseDeckData,
  resetSupabasePoints,
  signInWithPassword,
  signUpWithPassword,
  storeSession,
  updateSupabaseStudent,
} from "@/lib/supabase-rest";

type View =
  | "Dashboard"
  | "Students"
  | "Points"
  | "Assignment"
  | "Scoreboard"
  | "Reports"
  | "Admin";

type Modal = "addStudent" | "editStudent" | "importCsv" | "inviteUser" | null;

type NewStudentDraft = {
  id?: string;
  firstName: string;
  lastName: string;
  grade: string;
  familyId: string;
  house: HouseName;
};

const views: View[] = [
  "Dashboard",
  "Students",
  "Points",
  "Assignment",
  "Scoreboard",
  "Reports",
  "Admin",
];

const houses: HouseName[] = ["Red", "Blue", "Yellow", "Green"];

const emptyStudentDraft: NewStudentDraft = {
  firstName: "",
  lastName: "",
  grade: "5",
  familyId: "",
  house: "Red",
};

const emptyInviteDraft = {
  email: "",
  role: "teacher" as SupabaseRole,
};

type InviteOutcome = {
  email: string;
  inviteLink: string | null;
  message: string;
};

export function HouseDeckApp() {
  const [activeView, setActiveView] = useState<View>("Dashboard");
  const [students, setStudents] = useState<Student[]>(seedStudents);
  const [transactions, setTransactions] = useState<Transaction[]>(seedTransactions);
  const [query, setQuery] = useState("");
  const [houseFilter, setHouseFilter] = useState<"All" | HouseName>("All");
  const [selectedStudentId, setSelectedStudentId] = useState(seedStudents[0].id);
  const [pointAmount, setPointAmount] = useState(5);
  const [pointCategory, setPointCategory] = useState("Positive Behavior");
  const [pointReason, setPointReason] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [studentDraft, setStudentDraft] = useState<NewStudentDraft>(emptyStudentDraft);
  const [csvDraft, setCsvDraft] = useState("");
  const [inviteDraft, setInviteDraft] = useState(emptyInviteDraft);
  const [inviteOutcome, setInviteOutcome] = useState<InviteOutcome | null>(null);
  const [assignmentNames, setAssignmentNames] = useState("");
  const [toast, setToast] = useState("");
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [syncLabel, setSyncLabel] = useState("Syncing live data");
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [profile, setProfile] = useState<SupabaseProfile | null>(null);
  const [invites, setInvites] = useState<SupabaseInvite[]>([]);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [dataSource, setDataSource] = useState<"sample" | "supabase">("sample");
  const [supabaseReady, setSupabaseReady] = useState(false);
  const isAdmin = profile?.role === "admin";

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => b.points - a.points),
    [students],
  );

  const houseTotals = useMemo(() => getHouseTotals(students), [students]);
  const leadingHouse = houseTotals[0];
  const filteredStudents = sortedStudents.filter((student) => {
    const name = `${student.firstName} ${student.lastName}`.toLowerCase();
    const matchesQuery = name.includes(query.toLowerCase());
    const matchesHouse = houseFilter === "All" || student.house === houseFilter;
    return matchesQuery && matchesHouse;
  });
  const selectedStudent =
    students.find((student) => student.id === selectedStudentId) ?? students[0];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const refreshSupabaseData = useCallback(async (currentSession = session) => {
    if (!currentSession || !supabaseReady) return;

    try {
      const data = await loadHouseDeckData(currentSession.access_token, currentSession.user.id);
      setProfile(data.profile);
      setInvites(data.invites);
      setStudents(data.students.length > 0 ? data.students : seedStudents);
      setTransactions(data.transactions);
      setDataSource("supabase");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load Supabase data.");
    }
  }, [session, supabaseReady]);

  useEffect(() => {
    const updateSyncLabel = () => {
      setSyncLabel(
        new Intl.DateTimeFormat("en", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date()),
      );
    };

    updateSyncLabel();
    const interval = window.setInterval(updateSyncLabel, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSupabaseReady(isSupabaseConfigured());
      setSession(getStoredSession());
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!session || !supabaseReady) return;

    const timeout = window.setTimeout(() => {
      void refreshSupabaseData(session);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refreshSupabaseData, session, supabaseReady]);

  useEffect(() => {
    if (!session || !supabaseReady) return;

    const interval = window.setInterval(() => {
      void refreshSupabaseData(session);
    }, 15000);

    return () => window.clearInterval(interval);
  }, [refreshSupabaseData, session, supabaseReady]);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabaseReady) {
      notify("Add Supabase URL and anon key to .env.local first.");
      return;
    }

    try {
      const nextSession =
        authMode === "sign-in"
          ? await signInWithPassword(authEmail, authPassword)
          : await signUpWithPassword(authEmail, authPassword, authName);

      await ensureProfile(nextSession, authName);
      storeSession(nextSession);
      setSession(nextSession);
      setAuthPassword("");
      await refreshSupabaseData(nextSession);
      notify(authMode === "sign-in" ? "Signed in to Supabase." : "Account created.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Authentication failed.");
    }
  };

  const handleSignOut = () => {
    storeSession(null);
    setSession(null);
    setProfile(null);
    setInvites([]);
    setStudents(seedStudents);
    setTransactions(seedTransactions);
    setDataSource("sample");
    notify("Signed out. Showing sample data.");
  };

  const openPointsForStudent = (studentId: string) => {
    setSelectedStudentId(studentId);
    setActiveView("Points");
  };

  const openEditStudent = (student: Student) => {
    setEditingStudentId(student.id);
    setStudentDraft({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      grade: student.grade.toString(),
      familyId: student.familyId ?? "",
      house: student.house,
    });
    setModal("editStudent");
  };

  const closeModal = () => {
    setModal(null);
    setEditingStudentId(null);
    setStudentDraft(emptyStudentDraft);
    setInviteDraft(emptyInviteDraft);
    setInviteOutcome(null);
  };

  const addStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!studentDraft.firstName.trim() || !studentDraft.lastName.trim()) {
      notify("Add a first and last name.");
      return;
    }

    const studentInput: Omit<Student, "id"> = {
      firstName: studentDraft.firstName.trim(),
      lastName: studentDraft.lastName.trim(),
      grade: Number(studentDraft.grade) || 0,
      familyId: studentDraft.familyId.trim() || undefined,
      house: studentDraft.house,
      points: 0,
    };

    try {
      const newStudent =
        session && supabaseReady
          ? await createSupabaseStudent(session.access_token, studentInput)
          : { id: `stu-${Date.now()}`, ...studentInput };

      setStudents((current) => [newStudent, ...current]);
      setSelectedStudentId(newStudent.id);
      setStudentDraft(emptyStudentDraft);
      setModal(null);
      notify(`${newStudent.firstName} ${newStudent.lastName} added.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add student.");
    }
  };

  const updateStudent = async (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const studentId = studentDraft.id ?? editingStudentId;
    if (!studentId) {
      notify("Choose a student to edit first.");
      return;
    }
    if (!studentDraft.firstName.trim() || !studentDraft.lastName.trim()) {
      notify("Add a first and last name.");
      return;
    }

    const existingStudent = students.find((student) => student.id === studentId);
    if (!existingStudent) {
      notify("Student not found.");
      return;
    }

    const nextStudent: Student = {
      ...existingStudent,
      firstName: studentDraft.firstName.trim(),
      lastName: studentDraft.lastName.trim(),
      grade: Number(studentDraft.grade) || 0,
      familyId: studentDraft.familyId.trim() || undefined,
      house: studentDraft.house,
    };

    try {
      const savedStudent =
        session && supabaseReady
          ? await updateSupabaseStudent(session.access_token, nextStudent)
          : nextStudent;

      setStudents((current) =>
        current.map((student) => (student.id === savedStudent.id ? savedStudent : student)),
      );
      setModal(null);
      setEditingStudentId(null);
      setStudentDraft(emptyStudentDraft);
      notify(`${savedStudent.firstName} ${savedStudent.lastName} updated.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update student.");
    }
  };

  const importStudents = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const imported = parseStudentsCsv(csvDraft, students.length);
    if (imported.length === 0) {
      notify("Paste CSV rows with first name, last name, grade, and optional family ID.");
      return;
    }

    try {
      const savedStudents =
        session && supabaseReady
          ? await importSupabaseStudents(
              session.access_token,
              imported.map((student) => ({
                familyId: student.familyId,
                firstName: student.firstName,
                grade: student.grade,
                house: student.house,
                lastName: student.lastName,
                points: student.points,
              })),
            )
          : imported;

      setStudents((current) => [...savedStudents, ...current]);
      setCsvDraft("");
      setModal(null);
      notify(`${savedStudents.length} students imported.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not import students.");
    }
  };

  const inviteUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inviteDraft.email.includes("@")) {
      notify("Enter a valid email address.");
      return;
    }
    if (!session || !supabaseReady) {
      notify("Sign in to send invites.");
      return;
    }
    if (!isAdmin) {
      notify("Only admins can invite teachers.");
      return;
    }

    try {
      const result = await createTeacherInvite(session.access_token, inviteDraft);
      setInvites((current) => {
        const remaining = current.filter((invite) => invite.email !== result.invite.email);
        return [result.invite, ...remaining];
      });
      setInviteDraft(emptyInviteDraft);
      if (result.inviteLink) {
        await navigator.clipboard.writeText(result.inviteLink).catch(() => null);
        setInviteOutcome({
          email: result.invite.email,
          inviteLink: result.inviteLink,
          message:
            "Email delivery is limited right now, so HouseDeck generated a direct invite link you can share instead.",
        });
        notify(`Invite link copied for ${result.invite.email}. Share it directly with the teacher.`);
        return;
      }

      setModal(null);
      setInviteOutcome(null);
      notify(
        result.emailDelivery?.status === "pending"
          ? `${result.emailDelivery.message} Invite saved for ${result.invite.email}.`
          : `Invite sent to ${result.invite.email}.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save invite.");
    }
  };

  const awardPoints = async () => {
    if (!selectedStudent) return;

    try {
      const fallbackTransaction: Transaction = {
        id: `tx-${Date.now()}`,
        studentId: selectedStudent.id,
        points: pointAmount,
        category: pointCategory,
        reason: pointReason.trim() || "No note",
        teacher: session?.user.email ?? "Micah Gooden",
        date: new Date().toISOString().slice(0, 10),
      };

      const result =
        session && supabaseReady
          ? await awardSupabasePoints({
              accessToken: session.access_token,
              category: pointCategory,
              points: pointAmount,
              reason: pointReason.trim() || "No note",
              student: selectedStudent,
              teacherName: session.user.email ?? "Teacher",
            })
          : {
              student: { ...selectedStudent, points: selectedStudent.points + pointAmount },
              transaction: fallbackTransaction,
            };

      setStudents((current) =>
        current.map((student) =>
          student.id === selectedStudent.id ? result.student : student,
        ),
      );
      setTransactions((current) => [result.transaction, ...current]);
      setPointReason("");
      notify(`${pointAmount > 0 ? "+" : ""}${pointAmount} points saved.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save points.");
    }
  };

  const addAssignmentNames = () => {
    const names = assignmentNames
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (names.length === 0) {
      notify("Paste at least one student name.");
      return;
    }

    const assigned = names.map((name, index) => {
      const [firstName = "Student", ...rest] = name.split(/\s+/);
      const lastName = rest.join(" ") || "New";
      const draftStudents = names.slice(0, index).map((_, idx) => ({
        id: `draft-${idx}`,
        firstName: "Draft",
        lastName: "Student",
        grade: 0,
        house: houses[idx % houses.length],
        points: 0,
      })) satisfies Student[];
      const house = pickBalancedHouse([...students, ...draftStudents]);

      return {
        id: `stu-${Date.now()}-${index}`,
        firstName,
        lastName,
        grade: 0,
        house,
        points: 0,
      } satisfies Student;
    });

    setStudents((current) => [...assigned, ...current]);
    setAssignmentNames("");
    notify(`${assigned.length} students assigned to houses.`);
  };

  const resetPoints = async () => {
    try {
      if (session && supabaseReady) {
        await resetSupabasePoints(session.access_token);
      }

      setStudents((current) => current.map((student) => ({ ...student, points: 0 })));
      setTransactions([]);
      notify("All points reset for the current term.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not reset points.");
    }
  };

  const archiveAndReset = async () => {
    const snapshot = { students, transactions, archivedAt: new Date().toISOString() };

    try {
      if (session && supabaseReady) {
        await archiveSupabaseTerm(session.access_token, `Archive ${new Date().toLocaleDateString()}`, snapshot);
      }
      downloadJson("housedeck-term-archive.json", snapshot);
      await resetPoints();
      notify("Archive saved and term reset.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not archive term.");
    }
  };

  if (!session) {
    return (
      <>
        <LoginScreen
          authEmail={authEmail}
          authMode={authMode}
          authName={authName}
          authPassword={authPassword}
          onAuth={handleAuth}
          setAuthEmail={setAuthEmail}
          setAuthMode={setAuthMode}
          setAuthName={setAuthName}
          setAuthPassword={setAuthPassword}
        />
        <Toast message={toast} />
      </>
    );
  }

  if (activeView === "Scoreboard") {
    return (
      <Scoreboard
        houseTotals={houseTotals}
        onBack={() => setActiveView("Dashboard")}
        students={sortedStudents}
        syncLabel={syncLabel}
        transactions={transactions}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#050609] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute left-[-10%] top-[-20%] size-[520px] rounded-full bg-red-600/20 blur-3xl" />
        <div className="absolute right-[-8%] top-16 size-[500px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-20%] left-1/4 size-[520px] rounded-full bg-green-600/16 blur-3xl" />
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-[270px_1fr]">
        <aside className="border-b border-white/10 bg-black/45 px-4 py-4 backdrop-blur-xl lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="relative size-11 overflow-hidden rounded-lg border border-yellow-200/30 bg-black">
              <Image alt="HouseDeck lion logo" className="object-cover" fill sizes="44px" src="/brand/lion.png" />
            </div>
            <div>
              <p className="text-base font-semibold">HouseDeck</p>
              <p className="text-xs text-white/55">One school. Four houses.</p>
            </div>
          </div>

          <nav className="mt-6 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {views.map((view) => (
              <button
                key={view}
                className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                  activeView === view
                    ? "bg-white text-[#07080c]"
                    : "text-white/68 hover:bg-white/10 hover:text-white"
                }`}
                onClick={() => setActiveView(view)}
                type="button"
              >
                {view}
              </button>
            ))}
          </nav>

          <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.045] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
              House Totals
            </p>
            <div className="mt-3 grid gap-2">
              {houses.map((house) => (
                <div key={house} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-3 rounded-full" style={{ backgroundColor: houseStyles[house].hex }} />
                    {house}
                  </span>
                  <span className="font-mono text-xs text-white/60">
                    {houseTotals.find((item) => item.house === house)?.points ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-yellow-200/15 bg-yellow-200/[0.06] p-3 text-xs text-yellow-100/80">
            <p className="font-semibold uppercase tracking-[0.16em]">Status</p>
            <p className="mt-2">Live sync: {syncLabel}</p>
            <p className="mt-1">
              {dataSource === "supabase" ? "Database sync active." : "Loading database data."}
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.045] p-3 text-xs text-white/70">
            <p className="font-semibold uppercase tracking-[0.16em] text-white/50">
              Account
            </p>
            <p className="mt-2 truncate">{session.user.email ?? "Signed in"}</p>
            <div className="mt-3 grid gap-2">
              <button className="button-compact justify-center" onClick={() => void refreshSupabaseData()} type="button">
                Refresh Data
              </button>
              <button className="button-compact justify-center" onClick={handleSignOut} type="button">
                Sign Out
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-yellow-100/70">
                Modern school culture platform
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
                {activeView}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15" onClick={() => setModal("importCsv")} type="button">
                Import CSV
              </button>
              <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#07080c] hover:bg-yellow-100" onClick={() => setActiveView("Points")} type="button">
                Award Points
              </button>
            </div>
          </header>

          <div className="py-6">
            {activeView === "Dashboard" && (
              <Dashboard
                houseTotals={houseTotals}
                leadingHouse={leadingHouse}
                students={sortedStudents}
                transactions={transactions}
              />
            )}
            {activeView === "Students" && (
              <Students
                filteredStudents={filteredStudents}
                houseFilter={houseFilter}
                onAdd={() => setModal("addStudent")}
                onExport={() => downloadCsv("housedeck-students.csv", studentsToCsv(students))}
                onImport={() => setModal("importCsv")}
                onEdit={openEditStudent}
                onManage={openPointsForStudent}
                query={query}
                setHouseFilter={setHouseFilter}
                setQuery={setQuery}
              />
            )}
            {activeView === "Points" && selectedStudent && (
              <Points
                onAward={awardPoints}
                pointAmount={pointAmount}
                pointCategory={pointCategory}
                pointReason={pointReason}
                selectedStudent={selectedStudent}
                setPointAmount={setPointAmount}
                setPointCategory={setPointCategory}
                setPointReason={setPointReason}
                setSelectedStudentId={setSelectedStudentId}
                students={sortedStudents}
              />
            )}
            {activeView === "Assignment" && (
              <Assignment
                assignmentNames={assignmentNames}
                houseTotals={houseTotals}
                onDownloadTemplate={() => downloadCsv("housedeck-student-template.csv", "first_name,last_name,grade,family_id\nAlice,Johnson,5,FAM001")}
                onGenerate={addAssignmentNames}
                onOpenImport={() => setModal("importCsv")}
                setAssignmentNames={setAssignmentNames}
                students={students}
              />
            )}
            {activeView === "Reports" && (
              <Reports
                houseTotals={houseTotals}
                onExportStudents={() => downloadCsv("housedeck-students.csv", studentsToCsv(students))}
                onExportTransactions={() => downloadCsv("housedeck-transactions.csv", transactionsToCsv(transactions, students))}
                transactions={transactions}
              />
            )}
            {activeView === "Admin" && (
              <Admin
                houseTotals={houseTotals}
                invites={invites}
                isAdmin={isAdmin}
                onArchive={archiveAndReset}
                onBackup={() => {
                  downloadJson("housedeck-backup.json", { students, transactions });
                  notify("Backup downloaded.");
                }}
                onInvite={() => setModal("inviteUser")}
                onReset={resetPoints}
              />
            )}
          </div>
        </main>
      </div>

      <Toast message={toast} />
      <AppModal
        csvDraft={csvDraft}
        inviteDraft={inviteDraft}
        inviteOutcome={inviteOutcome}
        isAdmin={isAdmin}
        modal={modal}
        onAddStudent={addStudent}
        onClose={closeModal}
        onImport={importStudents}
        onInvite={inviteUser}
        onUpdateStudent={updateStudent}
        setCsvDraft={setCsvDraft}
        setInviteDraft={setInviteDraft}
        setStudentDraft={setStudentDraft}
        studentDraft={studentDraft}
      />
    </div>
  );
}

function Dashboard({
  houseTotals,
  leadingHouse,
  students,
  transactions,
}: {
  houseTotals: HouseTotal[];
  leadingHouse: HouseTotal;
  students: Student[];
  transactions: Transaction[];
}) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Students" note="0 unassigned" value={students.length.toString()} />
        <Metric label="Transactions" note="This term" value={transactions.length.toString()} />
        <Metric label="Leading House" note={`${leadingHouse.points} points`} value={leadingHouse.house} />
        <Metric label="Term Status" note="Ready for classrooms" value="Live" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <Panel action="Public display ready" title="House Standings">
          <div className="grid gap-3">
            {houseTotals.map((house, index) => (
              <HouseRow house={house} index={index} key={house.house} />
            ))}
          </div>
        </Panel>
        <Panel action="Leaderboard" title="Top Students">
          <StudentList students={students.slice(0, 6)} />
        </Panel>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Panel action="Portable" title="Setup Goals">
          <div className="grid gap-3 text-sm text-white/70">
            <p>Keep the four house colors fixed while allowing mascot artwork later.</p>
            <p>Separate admin tools, teacher point entry, and public scoreboard views.</p>
            <p>Store students, families, users, points, audit logs, and school terms in a real database.</p>
          </div>
        </Panel>
        <Panel action="Live feed" title="Recent Activity">
          <ActivityList students={students} transactions={transactions.slice(0, 5)} />
        </Panel>
      </section>
    </div>
  );
}

function LoginScreen({
  authEmail,
  authMode,
  authName,
  authPassword,
  onAuth,
  setAuthEmail,
  setAuthMode,
  setAuthName,
  setAuthPassword,
}: {
  authEmail: string;
  authMode: "sign-in" | "sign-up";
  authName: string;
  authPassword: string;
  onAuth: (event: FormEvent<HTMLFormElement>) => void;
  setAuthEmail: (value: string) => void;
  setAuthMode: (value: "sign-in" | "sign-up") => void;
  setAuthName: (value: string) => void;
  setAuthPassword: (value: string) => void;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030407] text-white">
      <div className="pointer-events-none absolute inset-0 opacity-75">
        <div className="absolute -left-24 top-10 size-[520px] rounded-full bg-red-600/20 blur-3xl" />
        <div className="absolute right-0 top-20 size-[520px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[18%] size-[520px] rounded-full bg-green-600/15 blur-3xl" />
        <div className="absolute bottom-10 right-[18%] size-[420px] rounded-full bg-yellow-400/10 blur-3xl" />
      </div>

      <section className="relative grid min-h-screen items-center gap-8 px-4 py-8 lg:grid-cols-[1fr_440px] lg:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <div className="relative mb-8 size-20 overflow-hidden rounded-lg border border-yellow-200/30 bg-black shadow-2xl shadow-yellow-900/20">
            <Image alt="HouseDeck lion logo" className="object-cover" fill priority sizes="80px" src="/brand/lion.png" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-yellow-100/70">
            One Pride. One School. One Lion.
          </p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight md:text-7xl">
            HouseDeck
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/68">
            A modern house-points system for live scoreboards, teacher point entry,
            student rosters, reports, and term archives.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-4">
            {houses.map((house) => (
              <div
                className="rounded-lg border bg-white/[0.045] p-4"
                key={house}
                style={{ borderColor: houseStyles[house].ring }}
              >
                <span className="block size-3 rounded-full" style={{ backgroundColor: houseStyles[house].hex }} />
                <p className="mt-3 text-sm font-semibold">{house} House</p>
                <p className="mt-1 text-xs text-white/45">Ready</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto w-full max-w-md rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-yellow-100/65">
              Staff Login
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              {authMode === "sign-in" ? "Sign in to continue" : "Create your account"}
            </h2>
            <p className="mt-2 text-sm text-white/58">
              Use your staff account to save changes to the Houses database.
            </p>
          </div>

          <form className="grid gap-3" onSubmit={onAuth}>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/20 p-1">
              <button
                className={`rounded-md px-3 py-2 text-sm font-semibold ${authMode === "sign-in" ? "bg-white text-[#07080c]" : "text-white/65"}`}
                onClick={() => setAuthMode("sign-in")}
                type="button"
              >
                Sign in
              </button>
              <button
                className={`rounded-md px-3 py-2 text-sm font-semibold ${authMode === "sign-up" ? "bg-white text-[#07080c]" : "text-white/65"}`}
                onClick={() => setAuthMode("sign-up")}
                type="button"
              >
                Create
              </button>
            </div>

            {authMode === "sign-up" ? (
              <label className="grid gap-1 text-sm font-medium">
                Full name
                <input
                  className="field"
                  onChange={(event) => setAuthName(event.target.value)}
                  placeholder="Micah Gooden"
                  value={authName}
                />
              </label>
            ) : null}

            <label className="grid gap-1 text-sm font-medium">
              Email
            <input
              className="field"
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="email@school.edu"
              type="email"
              value={authEmail}
            />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              Password
            <input
              className="field"
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="Password"
              type="password"
              value={authPassword}
            />
            </label>

            <button className="button-primary mt-2 justify-center py-3" type="submit">
              {authMode === "sign-in" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-white/45">
            Invited staff should create their account with the same school email that was invited.
            Email confirmation is required before the first sign-in.
          </p>
        </div>
      </section>
    </main>
  );
}

function Students({
  filteredStudents,
  houseFilter,
  onAdd,
  onEdit,
  onExport,
  onImport,
  onManage,
  query,
  setHouseFilter,
  setQuery,
}: {
  filteredStudents: Student[];
  houseFilter: "All" | HouseName;
  onAdd: () => void;
  onEdit: (student: Student) => void;
  onExport: () => void;
  onImport: () => void;
  onManage: (studentId: string) => void;
  query: string;
  setHouseFilter: (value: "All" | HouseName) => void;
  setQuery: (value: string) => void;
}) {
  return (
    <Panel action={`${filteredStudents.length} shown`} title="Student Roster">
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_auto_auto_auto]">
        <label className="grid gap-1 text-sm font-medium">
          Search
          <input className="field" onChange={(event) => setQuery(event.target.value)} placeholder="Search by student name" value={query} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          House
          <select className="field" onChange={(event) => setHouseFilter(event.target.value as "All" | HouseName)} value={houseFilter}>
            <option>All</option>
            {houses.map((house) => <option key={house}>{house}</option>)}
          </select>
        </label>
        <button className="button-secondary self-end" onClick={onExport} type="button">Export</button>
        <button className="button-secondary self-end" onClick={onImport} type="button">Import</button>
        <button className="button-primary self-end" onClick={onAdd} type="button">Add Student</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-[0.12em] text-white/45">
              <th className="py-3 font-semibold">Name</th>
              <th className="py-3 font-semibold">Grade</th>
              <th className="py-3 font-semibold">Family</th>
              <th className="py-3 font-semibold">House</th>
              <th className="py-3 text-right font-semibold">Points</th>
              <th className="py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map((student) => (
              <tr className="border-b border-white/10 last:border-0" key={student.id}>
                <td className="py-3 font-medium">{student.firstName} {student.lastName}</td>
                <td className="py-3 text-white/65">{student.grade || "New"}</td>
                <td className="py-3 font-mono text-xs text-white/55">{student.familyId ?? "None"}</td>
                <td className="py-3"><HouseBadge house={student.house} /></td>
                <td className="py-3 text-right font-mono">{student.points}</td>
                <td className="py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      aria-label={`Edit ${student.firstName} ${student.lastName}`}
                      className="button-compact"
                      onClick={() => onEdit(student)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Award points to ${student.firstName} ${student.lastName}`}
                      className="button-compact"
                      onClick={() => onManage(student.id)}
                      type="button"
                    >
                      Award
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Points({
  onAward,
  pointAmount,
  pointCategory,
  pointReason,
  selectedStudent,
  setPointAmount,
  setPointCategory,
  setPointReason,
  setSelectedStudentId,
  students,
}: {
  onAward: () => void;
  pointAmount: number;
  pointCategory: string;
  pointReason: string;
  selectedStudent: Student;
  setPointAmount: (value: number) => void;
  setPointCategory: (value: string) => void;
  setPointReason: (value: string) => void;
  setSelectedStudentId: (value: string) => void;
  students: Student[];
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Panel action="Fast entry" title="Find Student">
        <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
          {students.map((student) => (
            <button
              className={`rounded-lg border p-3 text-left transition ${
                selectedStudent.id === student.id
                  ? "border-yellow-200/70 bg-yellow-200/10"
                  : "border-white/10 bg-white/[0.035] hover:bg-white/10"
              }`}
              key={student.id}
              onClick={() => setSelectedStudentId(student.id)}
              type="button"
            >
              <span className="block font-medium">{student.firstName} {student.lastName}</span>
              <span className="mt-1 flex items-center justify-between text-xs text-white/55">
                <HouseBadge house={student.house} />
                {student.points} points
              </span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel action="Saves locally now" title="Award Points">
        <div className="grid gap-5">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm text-white/55">Selected student</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold">{selectedStudent.firstName} {selectedStudent.lastName}</p>
                <p className="mt-1 text-sm text-white/55">Grade {selectedStudent.grade || "New"} - {selectedStudent.points} current points</p>
              </div>
              <HouseBadge house={selectedStudent.house} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-6">
            {[1, 2, 5, 10, -1, -5].map((amount) => (
              <button className={pointAmount === amount ? "button-primary" : "button-secondary"} key={amount} onClick={() => setPointAmount(amount)} type="button">
                {amount > 0 ? `+${amount}` : amount}
              </button>
            ))}
          </div>
          <label className="grid gap-1 text-sm font-medium">
            Category
            <select className="field" onChange={(event) => setPointCategory(event.target.value)} value={pointCategory}>
              <option>Positive Behavior</option>
              <option>Academic Effort</option>
              <option>Participation</option>
              <option>Service</option>
              <option>Correction</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Reason
            <textarea className="field min-h-24" onChange={(event) => setPointReason(event.target.value)} placeholder="Add a short note for the activity feed and audit log" value={pointReason} />
          </label>
          <button className="button-primary w-full py-3" onClick={onAward} type="button">
            Award {pointAmount > 0 ? `+${pointAmount}` : pointAmount} Points
          </button>
        </div>
      </Panel>
    </div>
  );
}

function Assignment({
  assignmentNames,
  houseTotals,
  onDownloadTemplate,
  onGenerate,
  onOpenImport,
  setAssignmentNames,
  students,
}: {
  assignmentNames: string;
  houseTotals: HouseTotal[];
  onDownloadTemplate: () => void;
  onGenerate: () => void;
  onOpenImport: () => void;
  setAssignmentNames: (value: string) => void;
  students: Student[];
}) {
  const familyCount = new Set(students.map((student) => student.familyId).filter(Boolean)).size;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <Panel action="Family-safe" title="Balanced Assignment">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Students" note="Ready to assign" value={students.length.toString()} />
            <Metric label="Families" note="Grouped together" value={familyCount.toString()} />
            <Metric label="Unassigned" note="Current sample" value="0" />
          </div>
          <label className="grid gap-1 text-sm font-medium">
            Paste names
            <textarea className="field min-h-44" onChange={(event) => setAssignmentNames(event.target.value)} placeholder={"Alice Johnson\nBob Smith\nCharlie Brown"} value={assignmentNames} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="button-primary" onClick={onGenerate} type="button">Generate Assignment</button>
            <button className="button-secondary" onClick={onOpenImport} type="button">Upload CSV</button>
            <button className="button-secondary" onClick={onDownloadTemplate} type="button">Download Template</button>
          </div>
        </div>
      </Panel>
      <Panel action="Four colors fixed" title="Current Distribution">
        <div className="grid gap-3">
          {houseTotals.map((house) => <HouseRow house={house} key={house.house} />)}
        </div>
      </Panel>
    </div>
  );
}

function Scoreboard({
  houseTotals,
  onBack,
  students,
  syncLabel,
  transactions,
}: {
  houseTotals: HouseTotal[];
  onBack: () => void;
  students: Student[];
  syncLabel: string;
  transactions: Transaction[];
}) {
  const leadingHouse = houseTotals[0];
  const pointGap = houseTotals[0].points - houseTotals[1].points;
  const tickerItems = [...transactions, ...transactions];

  return (
    <div className="min-h-screen overflow-hidden bg-[#030407] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-40">
        <div className="absolute -left-24 top-12 size-96 rounded-full bg-red-600/20 blur-3xl" />
        <div className="absolute right-0 top-20 size-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 size-96 rounded-full bg-green-600/20 blur-3xl" />
        <div className="absolute bottom-20 right-1/4 size-96 rounded-full bg-yellow-400/15 blur-3xl" />
      </div>

      <main className="relative grid min-h-screen grid-rows-[auto_1fr_auto] gap-5 p-4 sm:p-6 xl:p-8">
        <header className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-yellow-300/40 bg-black">
              <Image alt="HouseDeck lion logo" className="object-cover" fill priority sizes="56px" src="/brand/lion.png" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-yellow-200">
                One Pride. One School. One Lion.
              </p>
              <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl xl:text-5xl">
                House Scoreboard
              </h1>
            </div>
          </div>
          <div className="hidden items-center gap-3 text-right md:flex">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/55">Live sync</p>
              <p className="font-mono text-sm text-white">{syncLabel}</p>
            </div>
            <span aria-hidden="true" className="scoreboard-live-dot" />
          </div>
          <button className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/15" onClick={onBack} type="button">
            Admin
          </button>
        </header>

        <section className="grid min-h-0 gap-5 xl:grid-cols-[1.6fr_0.8fr]">
          <div className="grid min-h-0 gap-4 lg:grid-cols-2">
            {houseTotals.map((house, index) => (
              <DisplayHouseCard gapFromLead={houseTotals[0].points - house.points} house={house} index={index} key={house.house} />
            ))}
          </div>

          <aside className="grid gap-5 xl:grid-rows-[auto_1fr]">
            <section className="overflow-hidden rounded-lg border border-yellow-300/25 bg-yellow-200/[0.07] p-5 shadow-2xl shadow-yellow-900/10">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-yellow-200">Leading House</p>
              <div className="mt-5 flex items-center gap-4">
                <div className="scoreboard-orb grid size-24 place-items-center rounded-full border text-4xl font-semibold" style={{ borderColor: houseStyles[leadingHouse.house].hex, boxShadow: `0 0 60px ${houseStyles[leadingHouse.house].ring}`, color: houseStyles[leadingHouse.house].hex }}>
                  1
                </div>
                <div>
                  <h2 className="text-4xl font-semibold">{leadingHouse.house}</h2>
                  <p className="font-mono text-5xl font-semibold tracking-tight">{leadingHouse.points}</p>
                  <p className="mt-1 text-sm text-white/60">{pointGap} point lead</p>
                </div>
              </div>
            </section>

            <section className="min-h-0 rounded-lg border border-white/10 bg-white/[0.045] p-5 backdrop-blur">
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/55">Top Students</p>
                  <h2 className="text-2xl font-semibold">Individual Leaders</h2>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-white/70">Live</span>
              </div>
              <div className="grid gap-3">
                {students.slice(0, 6).map((student, index) => (
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 p-3" key={student.id}>
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-lg bg-white/10 font-mono text-sm">{index + 1}</span>
                      <div>
                        <p className="font-semibold">{student.firstName} {student.lastName}</p>
                        <p className="text-xs text-white/55">{student.house} House - Grade {student.grade || "New"}</p>
                      </div>
                    </div>
                    <span className="font-mono text-xl font-semibold">{student.points}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>

        <footer className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] py-3">
          <div className="scoreboard-ticker flex min-w-max gap-10 px-4 text-sm font-medium text-white/75">
            {tickerItems.map((transaction, index) => {
              const student = students.find((item) => item.id === transaction.studentId);
              return (
                <span aria-hidden={index >= transactions.length} key={`${transaction.id}-${index}`}>
                  <span className="font-mono text-yellow-200">{transaction.points > 0 ? `+${transaction.points}` : transaction.points}</span>{" "}
                  {student ? `${student.firstName} ${student.lastName}` : "Student"} - {transaction.category}
                </span>
              );
            })}
          </div>
        </footer>
      </main>
    </div>
  );
}

function Reports({
  houseTotals,
  onExportStudents,
  onExportTransactions,
  transactions,
}: {
  houseTotals: HouseTotal[];
  onExportStudents: () => void;
  onExportTransactions: () => void;
  transactions: Transaction[];
}) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-3 md:grid-cols-3">
        <Metric label="Points Awarded" note="Current term" value={transactions.reduce((sum, tx) => sum + Math.max(tx.points, 0), 0).toString()} />
        <Metric label="Deductions" note="Current term" value={transactions.filter((tx) => tx.points < 0).length.toString()} />
        <Metric label="Exports" note="Students and transactions" value="CSV" />
      </section>
      <Panel action="Term reports" title="House Analytics">
        <div className="mb-5 flex flex-wrap gap-2">
          <button className="button-secondary" onClick={onExportTransactions} type="button">Export Transactions</button>
          <button className="button-secondary" onClick={onExportStudents} type="button">Export Students</button>
        </div>
        <div className="grid gap-4">
          {houseTotals.map((house) => (
            <div key={house.house}>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-medium">{house.house}</span>
                <span className="font-mono text-white/60">{house.points}</span>
              </div>
              <div className="h-3 rounded-full bg-white/10">
                <div className="h-3 rounded-full scoreboard-glow-bar" style={{ backgroundColor: houseStyles[house.house].hex, color: houseStyles[house.house].hex, width: `${house.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Admin({
  houseTotals,
  invites,
  isAdmin,
  onArchive,
  onBackup,
  onInvite,
  onReset,
}: {
  houseTotals: HouseTotal[];
  invites: SupabaseInvite[];
  isAdmin: boolean;
  onArchive: () => void;
  onBackup: () => void;
  onInvite: () => void;
  onReset: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <Panel action="Admin only" title="Settings">
        <div className="grid gap-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <p className="font-semibold">Branding</p>
            <p className="mt-1 text-sm text-white/65">
              Working name is HouseDeck. House colors are fixed, and mascot artwork can be layered in later.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className="button-secondary"
              disabled={!isAdmin}
              onClick={onInvite}
              type="button"
            >
              Invite Teacher
            </button>
            <button className="button-secondary" onClick={onBackup} type="button">Export Backup</button>
            <button className="button-secondary" onClick={onReset} type="button">Reset Points</button>
            <button className="button-primary" onClick={onArchive} type="button">Archive Term</button>
          </div>
          <p className="text-sm text-white/60">
            {isAdmin
              ? "Admins can invite staff and keep teacher roles synced with sign-in."
              : "Your account is a teacher account. Ask an admin to send staff invites."}
          </p>
        </div>
      </Panel>
      <Panel action="Locked colors" title="House Controls">
        <div className="grid gap-3">
          {houseTotals.map((house) => (
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3" key={house.house}>
              <div className="flex items-center justify-between">
                <HouseBadge house={house.house} />
                <span className="font-mono text-sm">{house.points}</span>
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-white/15 p-3 text-center text-xs text-white/50">
                Mascot slot
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel action={`${invites.length} tracked`} title="Pending Invites">
        <div className="grid gap-3">
          {invites.length === 0 ? (
            <p className="text-sm text-white/55">No invites yet. Admin invites will appear here once they are saved.</p>
          ) : (
            invites.map((invite) => (
              <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3" key={invite.email}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{invite.email}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/45">{invite.role}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs ${
                    invite.acceptedAt
                      ? "border-emerald-400/30 text-emerald-200"
                      : "border-yellow-300/30 text-yellow-100"
                  }`}>
                    {invite.acceptedAt ? "Accepted" : "Pending"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function DisplayHouseCard({
  gapFromLead,
  house,
  index,
}: {
  gapFromLead: number;
  house: HouseTotal;
  index: number;
}) {
  const style = houseStyles[house.house];
  const positionByHouse: Record<HouseName, string> = {
    Red: "left top",
    Blue: "right top",
    Green: "left bottom",
    Yellow: "right bottom",
  };

  return (
    <article className="group relative min-h-[260px] overflow-hidden rounded-lg border bg-black shadow-2xl" style={{ borderColor: style.ring, boxShadow: `0 0 44px ${style.ring}` }}>
      <div className="absolute inset-0 scale-105 bg-cover bg-center opacity-70 transition duration-700 group-hover:scale-110" style={{ backgroundImage: "url('/brand/houses.png')", backgroundPosition: positionByHouse[house.house], backgroundSize: "200% 200%" }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent_0,rgba(0,0,0,0.04)_19%,rgba(0,0,0,0.74)_42%,rgba(0,0,0,0.95)_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/40" />
      <div className="absolute left-1/2 top-[48%] grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-3xl font-semibold backdrop-blur-sm sm:size-32" style={{ borderColor: style.hex, boxShadow: `0 0 50px ${style.hex}`, color: style.hex }}>
        {index + 1}
      </div>
      <div className="relative flex h-full min-h-[260px] flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">
              {index === 0 ? "Current Leader" : gapFromLead === 0 ? "Tied" : `${gapFromLead} behind`}
            </p>
            <h2 className="mt-1 text-4xl font-semibold uppercase tracking-[0.12em]" style={{ color: style.hex }}>
              {house.house}
            </h2>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-right backdrop-blur">
            <p className="text-xs text-white/55">Students</p>
            <p className="font-mono text-xl font-semibold">{house.count}</p>
          </div>
        </div>

        <div>
          <p className="font-mono text-7xl font-semibold leading-none tracking-tighter sm:text-8xl">{house.points}</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full scoreboard-glow-bar" style={{ backgroundColor: style.hex, color: style.hex, width: `${house.percent}%` }} />
          </div>
        </div>
      </div>
    </article>
  );
}

function AppModal({
  csvDraft,
  inviteDraft,
  inviteOutcome,
  isAdmin,
  modal,
  onAddStudent,
  onClose,
  onImport,
  onInvite,
  onUpdateStudent,
  setCsvDraft,
  setInviteDraft,
  setStudentDraft,
  studentDraft,
}: {
  csvDraft: string;
  inviteDraft: { email: string; role: SupabaseRole };
  inviteOutcome: InviteOutcome | null;
  isAdmin: boolean;
  modal: Modal;
  onAddStudent: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onImport: (event: FormEvent<HTMLFormElement>) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateStudent: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>) => void;
  setCsvDraft: (value: string) => void;
  setInviteDraft: (value: { email: string; role: SupabaseRole }) => void;
  setStudentDraft: (value: NewStudentDraft) => void;
  studentDraft: NewStudentDraft;
}) {
  if (!modal) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-lg border border-white/10 bg-[#080a0f] p-5 shadow-2xl">
        {modal === "addStudent" && (
          <form className="grid gap-4" onSubmit={onAddStudent}>
            <ModalHeader onClose={onClose} title="Add Student" />
            <StudentFields setStudentDraft={setStudentDraft} studentDraft={studentDraft} />
            <button className="button-primary justify-center" type="submit">Save Student</button>
          </form>
        )}

        {modal === "editStudent" && (
          <form className="grid gap-4" onSubmit={onUpdateStudent}>
            <ModalHeader onClose={onClose} title="Edit Student" />
            <StudentFields setStudentDraft={setStudentDraft} studentDraft={studentDraft} />
            <button className="button-primary justify-center" onClick={onUpdateStudent} type="button">Save Changes</button>
          </form>
        )}

        {modal === "importCsv" && (
          <form className="grid gap-4" onSubmit={onImport}>
            <ModalHeader onClose={onClose} title="Import Students" />
            <p className="text-sm text-white/60">Paste rows as first_name,last_name,grade,family_id. A header row is optional.</p>
            <textarea className="field min-h-44" onChange={(event) => setCsvDraft(event.target.value)} placeholder={"first_name,last_name,grade,family_id\nAlice,Johnson,5,FAM001\nBob,Smith,4,"} value={csvDraft} />
            <button className="button-primary justify-center" type="submit">Import Students</button>
          </form>
        )}

        {modal === "inviteUser" && (
          <form className="grid gap-4" onSubmit={onInvite}>
            <ModalHeader onClose={onClose} title="Invite Teacher" />
            <p className="text-sm text-white/60">
              HouseDeck will try email first. If delivery is delayed, you can still share a direct invite link from here.
            </p>
            <label className="grid gap-1 text-sm">
              Email Address
              <input
                className="field"
                onChange={(event) => setInviteDraft({ ...inviteDraft, email: event.target.value })}
                placeholder="teacher@school.edu"
                type="email"
                value={inviteDraft.email}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Role
              <select
                className="field"
                disabled={!isAdmin}
                onChange={(event) => setInviteDraft({ ...inviteDraft, role: event.target.value as SupabaseRole })}
                value={inviteDraft.role}
              >
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {inviteOutcome && (
              <div className="grid gap-3 rounded-lg border border-yellow-200/20 bg-yellow-200/10 p-4">
                <div>
                  <p className="text-sm font-semibold text-yellow-100">Invite ready for {inviteOutcome.email}</p>
                  <p className="mt-1 text-sm text-yellow-50/80">{inviteOutcome.message}</p>
                </div>
                {inviteOutcome.inviteLink && (
                  <>
                    <textarea
                      className="field min-h-24 font-mono text-xs"
                      readOnly
                      value={inviteOutcome.inviteLink}
                    />
                    <button
                      className="button-secondary justify-center"
                      onClick={() => {
                        void navigator.clipboard.writeText(inviteOutcome.inviteLink ?? "").catch(() => null);
                      }}
                      type="button"
                    >
                      Copy Invite Link Again
                    </button>
                  </>
                )}
              </div>
            )}
            <button className="button-primary justify-center" type="submit">Send Invite</button>
          </form>
        )}
      </div>
    </div>
  );
}

function StudentFields({
  setStudentDraft,
  studentDraft,
}: {
  setStudentDraft: (value: NewStudentDraft) => void;
  studentDraft: NewStudentDraft;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">
        First Name
        <input
          className="field"
          onChange={(event) => setStudentDraft({ ...studentDraft, firstName: event.target.value })}
          value={studentDraft.firstName}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Last Name
        <input
          className="field"
          onChange={(event) => setStudentDraft({ ...studentDraft, lastName: event.target.value })}
          value={studentDraft.lastName}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Grade
        <input
          className="field"
          min="0"
          onChange={(event) => setStudentDraft({ ...studentDraft, grade: event.target.value })}
          type="number"
          value={studentDraft.grade}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Family ID
        <input
          className="field"
          onChange={(event) => setStudentDraft({ ...studentDraft, familyId: event.target.value })}
          placeholder="FAM001"
          value={studentDraft.familyId}
        />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        House
        <select
          className="field"
          onChange={(event) => setStudentDraft({ ...studentDraft, house: event.target.value as HouseName })}
          value={studentDraft.house}
        >
          {houses.map((house) => <option key={house}>{house}</option>)}
        </select>
      </label>
    </div>
  );
}

function ModalHeader({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <button className="button-compact" onClick={onClose} type="button">Close</button>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 rounded-lg border border-white/10 bg-[#0b0d12]/95 px-4 py-3 text-sm font-medium text-white shadow-2xl shadow-black/40"
    >
      {message}
    </div>
  );
}

function Panel({ action, children, title }: { action?: string; children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/20 backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action ? <span className="text-xs font-medium text-white/50">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-xl shadow-black/10">
      <p className="text-sm font-medium text-white/55">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-white/45">{note}</p>
    </div>
  );
}

function HouseBadge({ house }: { house: HouseName }) {
  const style = houseStyles[house];
  return (
    <span className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: style.soft, color: style.text }}>
      <span className="size-2.5 rounded-full" style={{ backgroundColor: style.hex }} />
      {house}
    </span>
  );
}

function HouseRow({ house, index }: { house: HouseTotal; index?: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {typeof index === "number" ? <span className="grid size-8 place-items-center rounded-lg bg-white/10 font-mono text-sm">{index + 1}</span> : null}
          <HouseBadge house={house.house} />
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{house.points}</p>
          <p className="text-xs text-white/50">{house.count} students</p>
        </div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-white/10">
        <div className="h-2 rounded-full scoreboard-glow-bar" style={{ backgroundColor: houseStyles[house.house].hex, color: houseStyles[house.house].hex, width: `${house.percent}%` }} />
      </div>
    </div>
  );
}

function StudentList({ students }: { students: Student[] }) {
  return (
    <div className="grid gap-2">
      {students.map((student, index) => (
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3" key={student.id}>
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-white/10 font-mono text-xs">{index + 1}</span>
            <div>
              <p className="font-medium">{student.firstName} {student.lastName}</p>
              <HouseBadge house={student.house} />
            </div>
          </div>
          <span className="font-mono font-semibold">{student.points}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityList({
  students = seedStudents,
  transactions,
}: {
  students?: Student[];
  transactions: Transaction[];
}) {
  return (
    <div className="grid gap-2">
      {transactions.map((transaction) => {
        const student = students.find((item) => item.id === transaction.studentId);
        return (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3" key={transaction.id}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{student ? `${student.firstName} ${student.lastName}` : "Student"}</p>
              <span className="font-mono text-sm font-semibold">{transaction.points > 0 ? `+${transaction.points}` : transaction.points}</span>
            </div>
            <p className="mt-1 text-sm text-white/55">{transaction.category} by {transaction.teacher} - {transaction.reason}</p>
          </div>
        );
      })}
    </div>
  );
}

type HouseTotal = {
  house: HouseName;
  points: number;
  count: number;
  percent: number;
};

function getHouseTotals(sourceStudents: Student[]): HouseTotal[] {
  const maxPoints = Math.max(
    1,
    ...houses.map((house) =>
      sourceStudents
        .filter((student) => student.house === house)
        .reduce((sum, student) => sum + student.points, 0),
    ),
  );

  return houses
    .map((house) => {
      const houseStudents = sourceStudents.filter((student) => student.house === house);
      const points = houseStudents.reduce((sum, student) => sum + student.points, 0);
      return {
        house,
        points,
        count: houseStudents.length,
        percent: Math.max(8, Math.round((points / maxPoints) * 100)),
      };
    })
    .sort((a, b) => b.points - a.points);
}

function pickBalancedHouse(sourceStudents: Student[]): HouseName {
  const totals = houses.map((house) => ({
    house,
    count: sourceStudents.filter((student) => student.house === house).length,
  }));
  return [...totals].sort((a, b) => a.count - b.count)[0].house;
}

function parseStudentsCsv(csv: string, currentCount: number): Student[] {
  const rows = csv
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .filter((row, index) => !(index === 0 && row.toLowerCase().includes("first")));

  return rows.flatMap((row, index) => {
    const [firstName, lastName, grade, familyId] = row.split(",").map((cell) => cell.trim());
    if (!firstName || !lastName) return [];
    return [{
      id: `stu-import-${Date.now()}-${index}`,
      firstName,
      lastName,
      grade: Number(grade) || 0,
      familyId: familyId || undefined,
      house: houses[(currentCount + index) % houses.length],
      points: 0,
    }];
  });
}

function studentsToCsv(students: Student[]) {
  return [
    "first_name,last_name,grade,family_id,house,points",
    ...students.map((student) =>
      [student.firstName, student.lastName, student.grade, student.familyId ?? "", student.house, student.points].join(","),
    ),
  ].join("\n");
}

function transactionsToCsv(transactions: Transaction[], students: Student[]) {
  return [
    "date,student,points,category,reason,teacher",
    ...transactions.map((transaction) => {
      const student = students.find((item) => item.id === transaction.studentId);
      return [
        transaction.date,
        student ? `${student.firstName} ${student.lastName}` : "Student",
        transaction.points,
        transaction.category,
        transaction.reason,
        transaction.teacher,
      ].join(",");
    }),
  ].join("\n");
}

function downloadCsv(filename: string, content: string) {
  downloadBlob(filename, content, "text/csv;charset=utf-8");
}

function downloadJson(filename: string, content: unknown) {
  downloadBlob(filename, JSON.stringify(content, null, 2), "application/json;charset=utf-8");
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
