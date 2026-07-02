"use client";

import Image from "next/image";
import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HouseName,
  Student,
  Transaction,
  houseStyles,
  students as seedStudents,
  transactions as seedTransactions,
} from "@/lib/sample-data";
import {
  approveSupabaseProfile,
  SupabaseProfile,
  SupabaseRole,
  SupabaseSession,
  archiveSupabaseTerm,
  awardSupabaseHousePoints,
  awardSupabasePoints,
  createSupabaseStudent,
  ensureProfile,
  getStoredSession,
  importSupabaseStudents,
  isSupabaseConfigured,
  isSupabaseSessionExpiredError,
  loadHouseDeckData,
  resetSupabasePoints,
  signInWithPassword,
  signUpWithPassword,
  storeSession,
  undoSupabaseTransaction,
  updateSupabaseStudent,
} from "@/lib/supabase-rest";

type View =
  | "Dashboard"
  | "Students"
  | "Assignment"
  | "Scoreboard"
  | "Reports"
  | "Admin";

type MobileNavIconName = "home" | "students" | "assign" | "scoreboard" | "reports" | "admin" | "signout";

type Modal = "addStudent" | "editStudent" | "importCsv" | null;

type NewStudentDraft = {
  id?: string;
  firstName: string;
  lastName: string;
  grade: string;
  familyId: string;
  house: HouseName;
};

type AdminHistoryPreset = {
  dateFilter: string;
  dateRange: "all" | "today" | "week" | "month";
  houseFilter: "All" | HouseName;
  query: string;
};

const views: View[] = [
  "Dashboard",
  "Students",
  "Assignment",
  "Scoreboard",
  "Reports",
  "Admin",
];

const mobileViewLabels: Record<View, string> = {
  Dashboard: "Home",
  Students: "Students",
  Assignment: "Assign",
  Scoreboard: "Board",
  Reports: "Reports",
  Admin: "Admin",
};

const mobileViewIcons: Record<View, Exclude<MobileNavIconName, "signout">> = {
  Dashboard: "home",
  Students: "students",
  Assignment: "assign",
  Scoreboard: "scoreboard",
  Reports: "reports",
  Admin: "admin",
};

const houses: HouseName[] = ["Red", "Blue", "Yellow", "Green"];
const mascotStorageKey = "housedeck.mascots";

const emptyStudentDraft: NewStudentDraft = {
  firstName: "",
  lastName: "",
  grade: "5",
  familyId: "",
  house: "Red",
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
  const [assignmentNames, setAssignmentNames] = useState("");
  const [toast, setToast] = useState("");
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [syncLabel, setSyncLabel] = useState("Syncing live data");
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [profile, setProfile] = useState<SupabaseProfile | null>(null);
  const [pendingProfiles, setPendingProfiles] = useState<SupabaseProfile[]>([]);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [dataSource, setDataSource] = useState<"sample" | "supabase">("sample");
  const [supabaseReady, setSupabaseReady] = useState(false);
  const [isAwardingPoints, setIsAwardingPoints] = useState(false);
  const [isUndoingTransactionId, setIsUndoingTransactionId] = useState<string | null>(null);
  const [isAwardingHouse, setIsAwardingHouse] = useState<HouseName | null>(null);
  const [adminHistoryPreset, setAdminHistoryPreset] = useState<AdminHistoryPreset | null>(null);
  const [housePointDrafts, setHousePointDrafts] = useState<Record<HouseName, string>>({
    Red: "10",
    Blue: "10",
    Yellow: "10",
    Green: "10",
  });
  const [mascotImages, setMascotImages] = useState<Record<HouseName, string | null>>({
    Red: null,
    Blue: null,
    Yellow: null,
    Green: null,
  });
  const isAdmin = profile?.role === "admin";
  const isApproved = profile?.approvalStatus === "approved";
  const visibleViews = useMemo(
    () =>
      isAdmin
        ? views
        : views.filter(
            (view) => view !== "Assignment" && view !== "Reports" && view !== "Admin",
          ),
    [isAdmin],
  );

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => b.points - a.points),
    [students],
  );

  const houseTotals = useMemo(() => getHouseTotals(students, transactions), [students, transactions]);
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

  const expireSession = useCallback(() => {
    storeSession(null);
    setSession(null);
    setProfile(null);
    setPendingProfiles([]);
    setStudents(seedStudents);
    setTransactions(seedTransactions);
    setDataSource("sample");
  }, []);

  const refreshSupabaseData = useCallback(async (currentSession = session) => {
    if (!currentSession || !supabaseReady) return;

    try {
      const data = await loadHouseDeckData(currentSession.access_token, currentSession.user.id);
      setPendingProfiles(data.pendingProfiles);
      setProfile(data.profile);
      setStudents(data.students.length > 0 ? data.students : seedStudents);
      setTransactions(data.transactions);
      setDataSource("supabase");
    } catch (error) {
      if (isSupabaseSessionExpiredError(error)) {
        expireSession();
        notify("Your sign-in expired. Please sign in again.");
        return;
      }
      notify(error instanceof Error ? error.message : "Could not load Supabase data.");
    }
  }, [expireSession, session, supabaseReady]);

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
      setMascotImages(loadStoredMascots());
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  const saveMascotImage = useCallback((house: HouseName, imageDataUrl: string | null) => {
    setMascotImages((current) => {
      const next = { ...current, [house]: imageDataUrl };
      storeMascots(next);
      return next;
    });
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

  useEffect(() => {
    if (isAdmin) return;
    if (activeView === "Assignment" || activeView === "Reports" || activeView === "Admin") {
      setActiveView("Dashboard");
    }
  }, [activeView, isAdmin]);

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
    expireSession();
    notify("Signed out. Showing sample data.");
  };

  const openPointsForStudent = (studentId: string) => {
    setSelectedStudentId(studentId);
    setActiveView("Students");
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

  const approveProfile = async (profileId: string, role: SupabaseRole) => {
    if (!session || !supabaseReady) {
      notify("Sign in to approve accounts.");
      return;
    }

    try {
      const result = await approveSupabaseProfile(session.access_token, { profileId, role });
      setPendingProfiles((current) => current.filter((item) => item.id !== profileId));
      notify(`${result.profile.fullName} approved as ${result.profile.role}.`);
      await refreshSupabaseData(session);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not approve account.");
    }
  };

  const awardPoints = async () => {
    if (!selectedStudent || isAwardingPoints) return;

    setIsAwardingPoints(true);
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
      if (isSupabaseSessionExpiredError(error)) {
        expireSession();
        notify("Your sign-in expired. Please sign in again before awarding points.");
        return;
      }
      notify(error instanceof Error ? error.message : "Could not save points.");
    } finally {
      setIsAwardingPoints(false);
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

  const awardHousePoints = async (house: HouseName) => {
    if (isAwardingHouse) return;
    const amount = Number(housePointDrafts[house]) || 0;
    if (!amount) {
      notify("Enter a point amount for that house.");
      return;
    }

    setIsAwardingHouse(house);
    try {
      const transaction =
        session && supabaseReady
          ? await awardSupabaseHousePoints({
              accessToken: session.access_token,
              category: "House Bonus",
              house,
              points: amount,
              reason: `${house} house adjustment`,
              teacherName: session.user.email ?? "Admin",
            })
          : {
              id: `tx-house-${Date.now()}`,
              house,
              points: amount,
              category: "House Bonus",
              reason: `${house} house adjustment`,
              teacher: session?.user.email ?? "Admin",
              date: new Date().toISOString().slice(0, 10),
            };

      setTransactions((current) => [transaction, ...current]);
      notify(`${amount > 0 ? "+" : ""}${amount} points added to ${house}.`);
    } catch (error) {
      if (isSupabaseSessionExpiredError(error)) {
        expireSession();
        notify("Your sign-in expired. Please sign in again before updating house points.");
        return;
      }
      notify(error instanceof Error ? error.message : "Could not update house points.");
    } finally {
      setIsAwardingHouse(null);
    }
  };

  const undoTransaction = async (transaction: Transaction) => {
    if (isUndoingTransactionId) return;

    setIsUndoingTransactionId(transaction.id);
    try {
      if (session && supabaseReady) {
        await undoSupabaseTransaction(session.access_token, transaction.id);
      }

      if (transaction.studentId) {
        setStudents((current) =>
          current.map((student) =>
            student.id === transaction.studentId
              ? { ...student, points: student.points - transaction.points }
              : student,
          ),
        );
      }

      setTransactions((current) => current.filter((item) => item.id !== transaction.id));
      notify("Transaction undone.");
    } catch (error) {
      if (isSupabaseSessionExpiredError(error)) {
        expireSession();
        notify("Your sign-in expired. Please sign in again before undoing transactions.");
        return;
      }
      notify(error instanceof Error ? error.message : "Could not undo transaction.");
    } finally {
      setIsUndoingTransactionId(null);
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

  const openFilteredTransactions = (preset: AdminHistoryPreset) => {
    setAdminHistoryPreset(preset);
    setActiveView("Admin");
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
        mascotImages={mascotImages}
        onBack={() => setActiveView("Dashboard")}
        students={sortedStudents}
        syncLabel={syncLabel}
        transactions={transactions}
      />
    );
  }

  if (!isApproved) {
    return (
      <>
        <PendingApprovalScreen
          email={session.user.email ?? "your account"}
          onRefresh={() => void refreshSupabaseData(session)}
          onSignOut={handleSignOut}
        />
        <Toast message={toast} />
      </>
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
        <aside className="border-b border-white/10 bg-black/45 px-4 py-4 backdrop-blur-xl lg:flex lg:min-h-screen lg:flex-col lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="relative size-11 overflow-hidden rounded-lg border border-yellow-200/30 bg-black">
              <Image alt="HouseDeck lion logo" className="object-cover" fill sizes="44px" src="/brand/lion.png" />
            </div>
            <div>
              <p className="text-base font-semibold">HouseDeck</p>
              <p className="text-xs text-white/55">One school. Four houses.</p>
            </div>
          </div>

          <nav className="mt-6 hidden lg:grid lg:grid-cols-1 lg:gap-2">
            {visibleViews.map((view) => (
              <button
                aria-current={activeView === view ? "page" : undefined}
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

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.045] p-3 lg:mt-6 lg:rounded-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
              House Totals
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
              {houses.map((house) => (
                <div key={house} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm lg:rounded-lg lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
                  <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="size-3 rounded-full" style={{ backgroundColor: houseStyles[house].hex }} />
                    {house}
                  </span>
                  <span className="font-mono text-xs text-white/60">
                    {houseTotals.find((item) => item.house === house)?.points ?? 0}
                  </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </aside>

        <main className="min-w-0 px-4 py-5 pb-28 sm:px-6 lg:px-8 lg:pb-6">
          <header className="mobile-header-shell flex flex-col gap-4 p-4 md:border-b-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-0">
            <div className="flex items-start justify-between gap-4 md:items-center">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-yellow-100/60 lg:hidden">
                  HouseDeck
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl md:mt-0 md:text-4xl">
                  {activeView}
                </h1>
              </div>
              <div className="mobile-header-pill shrink-0 rounded-full px-3 py-1.5 text-right lg:hidden">
                <p className="max-w-[132px] truncate text-[11px] font-medium text-white/70">
                  {session.user.email ?? "Signed in"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-4 md:border-t-0 md:pt-0">
              <p className="max-w-[220px] truncate text-xs text-white/45 sm:text-sm">
                {session.user.email ?? "Signed in"}
              </p>
              {isAdmin ? (
                <button className="hidden rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium hover:bg-white/15 lg:inline-flex lg:rounded-lg" onClick={() => setModal("importCsv")} type="button">
                  Import CSV
                </button>
              ) : null}
              <button
                className="hidden rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium hover:bg-white/15 lg:inline-flex lg:rounded-lg"
                onClick={handleSignOut}
                type="button"
              >
                Sign Out
              </button>
            </div>
          </header>

          <div className="py-6">
            {activeView === "Dashboard" && (
              <Dashboard
                houseTotals={houseTotals}
                leadingHouse={leadingHouse}
                mascotImages={mascotImages}
                onOpenFilteredTransactions={openFilteredTransactions}
                students={sortedStudents}
                transactions={transactions}
              />
            )}
            {activeView === "Students" && (
              <Students
                filteredStudents={filteredStudents}
                houseFilter={houseFilter}
                isAdmin={isAdmin}
                onAward={awardPoints}
                onAdd={() => setModal("addStudent")}
                onExport={() => downloadCsv("housedeck-students.csv", studentsToCsv(students))}
                onImport={() => setModal("importCsv")}
                onEdit={openEditStudent}
                onManage={openPointsForStudent}
                pointAmount={pointAmount}
                pointCategory={pointCategory}
                pointReason={pointReason}
                query={query}
                isAwardingPoints={isAwardingPoints}
                selectedStudent={selectedStudent}
                setPointAmount={setPointAmount}
                setPointCategory={setPointCategory}
                setPointReason={setPointReason}
                setHouseFilter={setHouseFilter}
                setQuery={setQuery}
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
            {isAdmin && activeView === "Reports" && (
              <Reports
                houseTotals={houseTotals}
                onExportStudents={() => downloadCsv("housedeck-students.csv", studentsToCsv(students))}
                onExportTransactions={() => downloadCsv("housedeck-transactions.csv", transactionsToCsv(transactions, students))}
                transactions={transactions}
              />
            )}
            {isAdmin && activeView === "Admin" && (
              <Admin
                houseTotals={houseTotals}
                housePointDrafts={housePointDrafts}
                isAdmin={isAdmin}
                mascotImages={mascotImages}
                pendingProfiles={pendingProfiles}
                students={students}
                transactions={transactions}
                historyPreset={adminHistoryPreset}
                isAwardingHouse={isAwardingHouse}
                isUndoingTransactionId={isUndoingTransactionId}
                onAwardHousePoints={awardHousePoints}
                onApproveProfile={approveProfile}
                onArchive={archiveAndReset}
                onBackup={() => {
                  downloadJson("housedeck-backup.json", { students, transactions });
                  notify("Backup downloaded.");
                }}
                onChangeMascot={saveMascotImage}
                onHistoryPresetConsumed={() => setAdminHistoryPreset(null)}
                onReset={resetPoints}
                onUndoTransaction={undoTransaction}
                setHousePointDrafts={setHousePointDrafts}
              />
            )}
          </div>
        </main>
      </div>

      <div className="mobile-nav-shell lg:hidden">
        <nav aria-label="Mobile navigation" className="mobile-nav">
          {visibleViews.map((view) => (
            <button
              aria-current={activeView === view ? "page" : undefined}
              key={view}
              className={`mobile-nav-item ${activeView === view ? "mobile-nav-item-active" : ""}`}
              onClick={() => setActiveView(view)}
              type="button"
            >
              <MobileNavIcon icon={mobileViewIcons[view]} />
              <span>{mobileViewLabels[view]}</span>
            </button>
          ))}
          <button
            className="mobile-nav-item"
            onClick={handleSignOut}
            type="button"
          >
            <MobileNavIcon icon="signout" />
            <span>Sign Out</span>
          </button>
        </nav>
      </div>

      <Toast message={toast} />
      <AppModal
        csvDraft={csvDraft}
        modal={modal}
        onAddStudent={addStudent}
        onClose={closeModal}
        onImport={importStudents}
        onUpdateStudent={updateStudent}
        setCsvDraft={setCsvDraft}
        setStudentDraft={setStudentDraft}
        studentDraft={studentDraft}
      />
    </div>
  );
}

function Dashboard({
  houseTotals,
  leadingHouse,
  mascotImages,
  onOpenFilteredTransactions,
  students,
  transactions,
}: {
  houseTotals: HouseTotal[];
  leadingHouse: HouseTotal;
  mascotImages: Record<HouseName, string | null>;
  onOpenFilteredTransactions: (preset: AdminHistoryPreset) => void;
  students: Student[];
  transactions: Transaction[];
}) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.date === todayKey),
    [todayKey, transactions],
  );
  const todayHouseTotals = useMemo(
    () =>
      houses.map((house) => ({
        house,
        points: todayTransactions
          .filter((transaction) => {
            if (transaction.house === house) return true;
            const student = students.find((item) => item.id === transaction.studentId);
            return student?.house === house;
          })
          .reduce((sum, transaction) => sum + transaction.points, 0),
      })),
    [students, todayTransactions],
  );
  const todayTeacherTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const transaction of todayTransactions) {
      totals.set(transaction.teacher, (totals.get(transaction.teacher) ?? 0) + transaction.points);
    }

    return [...totals.entries()]
      .map(([teacher, points]) => ({ teacher, points }))
      .sort((a, b) => b.points - a.points);
  }, [todayTransactions]);

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Students" note="0 unassigned" value={students.length.toString()} />
        <Metric label="Transactions" note="This term" value={transactions.length.toString()} />
        <Metric label="Leading House" note={`${leadingHouse.points} points`} value={leadingHouse.house} />
        <Metric label="Term Status" note="Ready for classrooms" value="Live" />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Panel action={todayKey} title="Today's House Totals">
          <div className="grid gap-3 sm:grid-cols-2">
            {todayHouseTotals.map((entry) => (
              <button
                aria-label={`Open today's ${entry.house} House transactions`}
                className="dashboard-chip rounded-xl p-4 text-left transition hover:border-white/25 hover:bg-white/[0.08]"
                key={entry.house}
                onClick={() =>
                  onOpenFilteredTransactions({
                    dateFilter: todayKey,
                    dateRange: "all",
                    houseFilter: entry.house,
                    query: "",
                  })
                }
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <HouseBadge house={entry.house} />
                  <span className="font-mono text-lg font-semibold">
                    {entry.points > 0 ? `+${entry.points}` : entry.points}
                  </span>
                </div>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-white/45">Open transactions</p>
              </button>
            ))}
          </div>
        </Panel>
        <Panel action={`${todayTeacherTotals.length} active`} title="Today's Teacher Totals">
          <div className="grid gap-3">
            {todayTeacherTotals.length === 0 ? (
              <p className="text-sm text-white/55">No points have been recorded yet today.</p>
            ) : (
              todayTeacherTotals.slice(0, 6).map((entry) => (
                <button
                  aria-label={`Open today's transactions for ${entry.teacher}`}
                  className="dashboard-chip flex items-center justify-between rounded-xl p-4 text-left transition hover:border-white/25 hover:bg-white/[0.08]"
                  key={entry.teacher}
                  onClick={() =>
                    onOpenFilteredTransactions({
                      dateFilter: todayKey,
                      dateRange: "all",
                      houseFilter: "All",
                      query: entry.teacher,
                    })
                  }
                  type="button"
                >
                  <p className="font-medium">{entry.teacher}</p>
                  <span className="font-mono text-lg font-semibold">
                    {entry.points > 0 ? `+${entry.points}` : entry.points}
                  </span>
                </button>
              ))
            )}
          </div>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <Panel action="Public display ready" title="House Standings">
          <div className="grid gap-3">
            {houseTotals.map((house, index) => (
              <HouseRow
                house={house}
                index={index}
                key={house.house}
                mascotImage={mascotImages[house.house]}
                onClick={() =>
                  onOpenFilteredTransactions({
                    dateFilter: "",
                    dateRange: "all",
                    houseFilter: house.house,
                    query: "",
                  })
                }
              />
            ))}
          </div>
        </Panel>
        <Panel action="Leaderboard" title="Top Students">
          <StudentList
            onSelectStudent={(student) =>
              onOpenFilteredTransactions({
                dateFilter: "",
                dateRange: "all",
                houseFilter: student.house,
                query: `${student.firstName} ${student.lastName}`,
              })
            }
            students={students.slice(0, 6)}
          />
        </Panel>
      </section>

      <Panel action="Live feed" title="Recent Activity">
        <ActivityList
          onSelectTransaction={(transaction) =>
            onOpenFilteredTransactions({
              dateFilter: transaction.date,
              dateRange: "all",
              houseFilter: transaction.house ?? "All",
              query: transaction.teacher,
            })
          }
          students={students}
          transactions={transactions.slice(0, 5)}
        />
      </Panel>
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

      <section className="relative grid min-h-screen items-center gap-10 px-4 py-8 lg:grid-cols-[1.1fr_440px] lg:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <div className="relative mb-8 size-20 overflow-hidden rounded-2xl border border-yellow-200/30 bg-black shadow-2xl shadow-yellow-900/20">
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

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="dashboard-chip rounded-2xl p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Built for staff</p>
              <p className="mt-2 text-sm text-white/75">Fast point entry, clear reporting, and simple house tracking.</p>
            </div>
            <div className="dashboard-chip rounded-2xl p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Mobile ready</p>
              <p className="mt-2 text-sm text-white/75">Optimized for quick classroom use from a phone.</p>
            </div>
            <div className="dashboard-chip rounded-2xl p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Live history</p>
              <p className="mt-2 text-sm text-white/75">Track points, review changes, and filter activity in seconds.</p>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-4">
            {houses.map((house) => (
              <div
                className="dashboard-chip rounded-2xl p-4"
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

        <div className="login-shell mx-auto w-full max-w-md p-5 sm:p-6">
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
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1">
              <button
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${authMode === "sign-in" ? "login-tab-active" : "text-white/65"}`}
                onClick={() => setAuthMode("sign-in")}
                type="button"
              >
                Sign in
              </button>
              <button
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${authMode === "sign-up" ? "login-tab-active" : "text-white/65"}`}
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

            <button className="button-primary mt-2 justify-center rounded-xl py-3.5" type="submit">
              {authMode === "sign-in" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-white/45">
            Teachers can create their own account here. An administrator will approve access before any school data is shown.
          </p>
        </div>
      </section>
    </main>
  );
}

function PendingApprovalScreen({
  email,
  onRefresh,
  onSignOut,
}: {
  email: string;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030407] text-white">
      <div className="pointer-events-none absolute inset-0 opacity-75">
        <div className="absolute -left-24 top-10 size-[520px] rounded-full bg-red-600/20 blur-3xl" />
        <div className="absolute right-0 top-20 size-[520px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[18%] size-[520px] rounded-full bg-green-600/15 blur-3xl" />
      </div>
      <section className="relative grid min-h-screen place-items-center px-4 py-8">
        <div className="w-full max-w-xl rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-yellow-100/65">Awaiting Approval</p>
          <h1 className="mt-3 text-3xl font-semibold">Your account is waiting for an administrator.</h1>
          <p className="mt-4 text-sm leading-7 text-white/65">
            {email} has been created successfully. An administrator needs to approve your account before you can see school data.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="button-primary" onClick={onRefresh} type="button">Check Again</button>
            <button className="button-secondary" onClick={onSignOut} type="button">Sign Out</button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Students({
  filteredStudents,
  houseFilter,
  isAdmin,
  onAward,
  onAdd,
  onEdit,
  onExport,
  onImport,
  onManage,
  isAwardingPoints,
  pointAmount,
  pointCategory,
  pointReason,
  query,
  selectedStudent,
  setPointAmount,
  setPointCategory,
  setPointReason,
  setHouseFilter,
  setQuery,
  setSelectedStudentId,
  students,
}: {
  filteredStudents: Student[];
  houseFilter: "All" | HouseName;
  isAdmin: boolean;
  onAward: () => void;
  onAdd: () => void;
  onEdit: (student: Student) => void;
  onExport: () => void;
  onImport: () => void;
  onManage: (studentId: string) => void;
  isAwardingPoints: boolean;
  pointAmount: number;
  pointCategory: string;
  pointReason: string;
  query: string;
  selectedStudent: Student;
  setPointAmount: (value: number) => void;
  setPointCategory: (value: string) => void;
  setPointReason: (value: string) => void;
  setHouseFilter: (value: "All" | HouseName) => void;
  setQuery: (value: string) => void;
  setSelectedStudentId: (value: string) => void;
  students: Student[];
}) {
  const awardPanelRef = useRef<HTMLDivElement | null>(null);
  const handleManageStudent = (studentId: string) => {
    onManage(studentId);
    window.requestAnimationFrame(() => {
      awardPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="grid gap-5">
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
          {isAdmin ? (
            <button className="button-secondary min-h-11 self-end justify-center" onClick={onExport} type="button">Export</button>
          ) : null}
          {isAdmin ? (
            <button className="button-secondary min-h-11 self-end justify-center" onClick={onImport} type="button">Import</button>
          ) : null}
          {isAdmin ? (
            <button className="button-primary min-h-11 self-end justify-center" onClick={onAdd} type="button">Add Student</button>
          ) : null}
        </div>
        <div className="mb-4 rounded-2xl border border-yellow-200/15 bg-yellow-200/[0.06] p-3 md:hidden">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-yellow-100/60">Selected for points</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{selectedStudent.firstName} {selectedStudent.lastName}</p>
              <p className="mt-1 text-sm text-white/60">
                {selectedStudent.points} points • {selectedStudent.house} House
              </p>
            </div>
            <button
              className="button-primary shrink-0 justify-center"
              onClick={() => {
                window.requestAnimationFrame(() => {
                  awardPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
              type="button"
            >
              Award
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:hidden">
          {filteredStudents.map((student) => (
            <article
              className={`rounded-2xl border p-4 transition ${
                student.id === selectedStudent.id
                  ? "border-yellow-200/40 bg-yellow-200/[0.08] shadow-[0_0_0_1px_rgba(253,224,71,0.15)]"
                  : "border-white/10 bg-white/[0.045]"
              }`}
              key={student.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{student.firstName} {student.lastName}</p>
                  <p className="mt-1 text-sm text-white/60">Grade {student.grade || "New"}</p>
                </div>
                <HouseBadge house={student.house} />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-white/60">
                <span>Family {student.familyId ?? "None"}</span>
                <span className="font-mono text-white">{student.points} pts</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {isAdmin ? (
                  <button
                    aria-label={`Edit ${student.firstName} ${student.lastName}`}
                    className="button-compact justify-center"
                    onClick={() => onEdit(student)}
                    type="button"
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  aria-label={`Award points to ${student.firstName} ${student.lastName}`}
                  className={student.id === selectedStudent.id ? "button-secondary justify-center" : "button-primary justify-center"}
                  onClick={() => handleManageStudent(student.id)}
                  type="button"
                >
                  {student.id === selectedStudent.id ? "Selected" : "Award"}
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
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
                <tr
                  className={`border-b border-white/10 last:border-0 ${
                    student.id === selectedStudent.id ? "bg-yellow-200/[0.05]" : ""
                  }`}
                  key={student.id}
                >
                  <td className="py-3 font-medium">{student.firstName} {student.lastName}</td>
                  <td className="py-3 text-white/65">{student.grade || "New"}</td>
                  <td className="py-3 font-mono text-xs text-white/55">{student.familyId ?? "None"}</td>
                  <td className="py-3"><HouseBadge house={student.house} /></td>
                  <td className="py-3 text-right font-mono">{student.points}</td>
                  <td className="py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {isAdmin ? (
                        <button
                          aria-label={`Edit ${student.firstName} ${student.lastName}`}
                          className="button-compact"
                          onClick={() => onEdit(student)}
                          type="button"
                        >
                          Edit
                        </button>
                      ) : null}
                      <button
                        aria-label={`Award points to ${student.firstName} ${student.lastName}`}
                        className="button-compact"
                        onClick={() => handleManageStudent(student.id)}
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

      <div ref={awardPanelRef}>
        <Points
          onAward={onAward}
          isAwardingPoints={isAwardingPoints}
          pointAmount={pointAmount}
          pointCategory={pointCategory}
          pointReason={pointReason}
          selectedStudent={selectedStudent}
          setPointAmount={setPointAmount}
          setPointCategory={setPointCategory}
          setPointReason={setPointReason}
        />
      </div>
    </div>
  );
}

function Points({
  onAward,
  isAwardingPoints,
  pointAmount,
  pointCategory,
  pointReason,
  selectedStudent,
  setPointAmount,
  setPointCategory,
  setPointReason,
}: {
  onAward: () => void;
  isAwardingPoints: boolean;
  pointAmount: number;
  pointCategory: string;
  pointReason: string;
  selectedStudent: Student;
  setPointAmount: (value: number) => void;
  setPointCategory: (value: string) => void;
  setPointReason: (value: string) => void;
}) {
  return (
    <div>
      <Panel action="Few taps" title="Award Points">
        <div className="grid gap-4">
          <div className="sticky top-3 z-10 rounded-2xl border border-white/10 bg-[#11141b]/95 p-4 backdrop-blur md:static md:bg-white/[0.04] md:backdrop-blur-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Selected student</p>
                <p className="mt-2 text-2xl font-semibold">{selectedStudent.firstName} {selectedStudent.lastName}</p>
                <p className="mt-1 text-sm text-white/55">
                  Grade {selectedStudent.grade || "New"} · {selectedStudent.points} current points
                </p>
              </div>
              <HouseBadge house={selectedStudent.house} />
            </div>
          </div>
          <div className="rounded-2xl border border-yellow-200/15 bg-yellow-200/[0.06] px-4 py-3">
            <span className="block text-xs uppercase tracking-[0.18em] text-yellow-100/60">Ready to award</span>
            <span className="mt-1 block text-sm text-yellow-50/80">Pick a student, tap an amount, choose a category, then save.</span>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <p className="text-sm font-medium text-white/55">Point amount</p>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[1, 2, 5, 10, -1, -5].map((amount) => (
              <button
                className={pointAmount === amount ? "button-primary min-h-12 justify-center py-3" : "button-secondary min-h-12 justify-center py-3"}
                disabled={isAwardingPoints}
                key={amount}
                onClick={() => setPointAmount(amount)}
                type="button"
              >
                {amount > 0 ? `+${amount}` : amount}
              </button>
            ))}
            </div>
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
            <textarea className="field min-h-24" disabled={isAwardingPoints} onChange={(event) => setPointReason(event.target.value)} placeholder="Add a short note for the activity feed and audit log" value={pointReason} />
          </label>
          <button className="button-primary hidden w-full justify-center py-3 md:inline-flex disabled:cursor-not-allowed disabled:opacity-60" disabled={isAwardingPoints} onClick={onAward} type="button">
            {isAwardingPoints ? "Saving..." : `Award ${pointAmount > 0 ? `+${pointAmount}` : pointAmount} Points`}
          </button>
          <div className="sticky bottom-3 z-10 md:hidden">
            <button className="button-primary w-full justify-center py-4 text-base shadow-2xl shadow-black/40 disabled:cursor-not-allowed disabled:opacity-60" disabled={isAwardingPoints} onClick={onAward} type="button">
              {isAwardingPoints
                ? `Saving for ${selectedStudent.firstName}...`
                : `Award ${pointAmount > 0 ? `+${pointAmount}` : pointAmount} Points to ${selectedStudent.firstName}`}
            </button>
          </div>
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
  mascotImages,
  onBack,
  students,
  syncLabel,
  transactions,
}: {
  houseTotals: HouseTotal[];
  mascotImages: Record<HouseName, string | null>;
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
              <DisplayHouseCard gapFromLead={houseTotals[0].points - house.points} house={house} index={index} key={house.house} mascotImage={mascotImages[house.house]} />
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
  housePointDrafts,
  isAdmin,
  mascotImages,
  pendingProfiles,
  students,
  transactions,
  historyPreset,
  isAwardingHouse,
  isUndoingTransactionId,
  onAwardHousePoints,
  onApproveProfile,
  onArchive,
  onBackup,
  onChangeMascot,
  onHistoryPresetConsumed,
  onReset,
  onUndoTransaction,
  setHousePointDrafts,
}: {
  houseTotals: HouseTotal[];
  housePointDrafts: Record<HouseName, string>;
  isAdmin: boolean;
  mascotImages: Record<HouseName, string | null>;
  pendingProfiles: SupabaseProfile[];
  students: Student[];
  transactions: Transaction[];
  historyPreset: AdminHistoryPreset | null;
  isAwardingHouse: HouseName | null;
  isUndoingTransactionId: string | null;
  onAwardHousePoints: (house: HouseName) => void;
  onApproveProfile: (profileId: string, role: SupabaseRole) => void;
  onArchive: () => void;
  onBackup: () => void;
  onChangeMascot: (house: HouseName, imageDataUrl: string | null) => void;
  onHistoryPresetConsumed: () => void;
  onReset: () => void;
  onUndoTransaction: (transaction: Transaction) => void;
  setHousePointDrafts: (value: Record<HouseName, string> | ((current: Record<HouseName, string>) => Record<HouseName, string>)) => void;
}) {
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyHouseFilter, setHistoryHouseFilter] = useState<"All" | HouseName>("All");
  const [historyDateFilter, setHistoryDateFilter] = useState("");
  const [historyDateRange, setHistoryDateRange] = useState<"all" | "today" | "week" | "month">("all");
  const [historySort, setHistorySort] = useState<"newest" | "oldest" | "points-high" | "points-low">("newest");
  const historyPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!historyPreset) return;

    setHistoryQuery(historyPreset.query);
    setHistoryHouseFilter(historyPreset.houseFilter);
    setHistoryDateFilter(historyPreset.dateFilter);
    setHistoryDateRange(historyPreset.dateRange);
    setHistorySort("newest");
    window.requestAnimationFrame(() => {
      historyPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    onHistoryPresetConsumed();
  }, [historyPreset, onHistoryPresetConsumed]);

  const normalizedHistoryQuery = historyQuery.trim().toLowerCase();
  const filteredTransactions = useMemo(() => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekStartKey = weekStart.toISOString().slice(0, 10);
    const monthStartKey = `${todayKey.slice(0, 7)}-01`;

    return transactions.filter((transaction) => {
      const student = students.find((item) => item.id === transaction.studentId);
      const subject = student
        ? `${student.firstName} ${student.lastName}`
        : transaction.house
          ? `${transaction.house} House`
          : "House";
      const teacher = transaction.teacher ?? "";
      const haystack = [
        subject,
        teacher,
        transaction.category,
        transaction.reason,
        transaction.date,
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !normalizedHistoryQuery || haystack.includes(normalizedHistoryQuery);
      const matchesHouse =
        historyHouseFilter === "All" ||
        transaction.house === historyHouseFilter ||
        student?.house === historyHouseFilter;
      const matchesDate = !historyDateFilter || transaction.date === historyDateFilter;
      const matchesRange =
        historyDateRange === "all" ||
        (historyDateRange === "today" && transaction.date === todayKey) ||
        (historyDateRange === "week" && transaction.date >= weekStartKey && transaction.date <= todayKey) ||
        (historyDateRange === "month" && transaction.date >= monthStartKey && transaction.date <= todayKey);
      return matchesQuery && matchesHouse && matchesDate && matchesRange;
    });
  }, [historyDateFilter, historyDateRange, historyHouseFilter, normalizedHistoryQuery, students, transactions]);
  const sortedTransactions = useMemo(() => {
    return [...filteredTransactions].sort((a, b) => {
      if (historySort === "oldest") {
        return a.date.localeCompare(b.date);
      }
      if (historySort === "points-high") {
        return b.points - a.points;
      }
      if (historySort === "points-low") {
        return a.points - b.points;
      }
      return b.date.localeCompare(a.date);
    });
  }, [filteredTransactions, historySort]);
  const filteredPositivePoints = useMemo(
    () => sortedTransactions.reduce((sum, transaction) => sum + Math.max(transaction.points, 0), 0),
    [sortedTransactions],
  );
  const filteredDeductions = useMemo(
    () => sortedTransactions.reduce((sum, transaction) => sum + Math.min(transaction.points, 0), 0),
    [sortedTransactions],
  );
  const filteredNetPoints = filteredPositivePoints + filteredDeductions;
  const hasActiveHistoryFilters =
    historyQuery.trim().length > 0 ||
    historyHouseFilter !== "All" ||
    historyDateFilter.length > 0 ||
    historyDateRange !== "all" ||
    historySort !== "newest";
  const historyBreadcrumb = [
    historyHouseFilter !== "All" ? historyHouseFilter : null,
    historyQuery.trim() ? `Search: ${historyQuery.trim()}` : null,
    historyDateFilter ? historyDateFilter : null,
    !historyDateFilter && historyDateRange !== "all"
      ? historyDateRange === "today"
        ? "Today"
        : historyDateRange === "week"
          ? "This Week"
          : "This Month"
      : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <Panel action="Admin only" title="Settings">
        <div className="grid gap-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <p className="font-semibold">Branding</p>
            <p className="mt-1 text-sm text-white/65">
              Working name is HouseDeck. House colors are fixed, and mascot artwork can be uploaded below for the live display.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="button-secondary" onClick={onBackup} type="button">Export Backup</button>
            <button className="button-secondary" onClick={onReset} type="button">Reset Points</button>
            <button className="button-primary" onClick={onArchive} type="button">Archive Term</button>
          </div>
          <p className="text-sm text-white/60">
            {isAdmin
              ? "Teachers can create their own login, and admins approve access here before school data opens up."
              : "Your account is a teacher account."}
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
              <div className="mt-3 grid gap-3">
                <div className="relative overflow-hidden rounded-lg border border-dashed border-white/15 bg-black/20">
                  {mascotImages[house.house] ? (
                    <img
                      alt={`${house.house} mascot`}
                      className="h-32 w-full object-cover"
                      src={mascotImages[house.house] ?? undefined}
                    />
                  ) : (
                    <div className="grid h-32 place-items-center text-center text-xs text-white/50">
                      Mascot slot
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="field max-w-[120px]"
                    disabled={isAwardingHouse === house.house}
                    onChange={(event) =>
                      setHousePointDrafts((current) => ({
                        ...current,
                        [house.house]: event.target.value,
                      }))
                    }
                    placeholder="10"
                    type="number"
                    value={housePointDrafts[house.house]}
                  />
                  <button className="button-primary disabled:cursor-not-allowed disabled:opacity-60" disabled={isAwardingHouse === house.house} onClick={() => onAwardHousePoints(house.house)} type="button">
                    {isAwardingHouse === house.house ? "Saving..." : "Add Points"}
                  </button>
                  <label className="button-secondary cursor-pointer">
                    Upload Mascot
                    <input
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result === "string") {
                            onChangeMascot(house.house, reader.result);
                          }
                        };
                        reader.readAsDataURL(file);
                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  {mascotImages[house.house] ? (
                    <button className="button-compact" onClick={() => onChangeMascot(house.house, null)} type="button">
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel action={`${pendingProfiles.length} waiting`} title="Access Requests">
        <div className="grid gap-3">
          {pendingProfiles.length === 0 ? (
            <p className="text-sm text-white/55">No teacher signups are waiting for approval right now.</p>
          ) : (
            pendingProfiles.map((pendingProfile) => (
              <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3" key={pendingProfile.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{pendingProfile.fullName}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-yellow-100/70">
                      Awaiting approval
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="button-secondary"
                      onClick={() => onApproveProfile(pendingProfile.id, "teacher")}
                      type="button"
                    >
                      Approve Teacher
                    </button>
                    <button
                      className="button-primary"
                      onClick={() => onApproveProfile(pendingProfile.id, "admin")}
                      type="button"
                    >
                      Make Admin
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
      <div ref={historyPanelRef}>
      <Panel action={`${sortedTransactions.length} shown`} title="Transaction History">
        <div className="grid gap-3">
          {hasActiveHistoryFilters ? (
            <div className="rounded-xl border border-yellow-200/15 bg-[linear-gradient(135deg,rgba(253,224,71,0.12),rgba(253,224,71,0.04))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-yellow-100/60">
                    Filtered View
                  </p>
                  <p className="mt-1 text-sm text-yellow-50/85">
                    {historyBreadcrumb || "Custom transaction filters are active."}
                  </p>
                </div>
                <button
                  className="button-secondary"
                  onClick={() => {
                    setHistoryQuery("");
                    setHistoryHouseFilter("All");
                    setHistoryDateFilter("");
                    setHistoryDateRange("all");
                    setHistorySort("newest");
                  }}
                  type="button"
                >
                  Back to Full Admin View
                </button>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_180px]">
            <label className="grid gap-1 text-sm font-medium">
              Search
              <input
                className="field"
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Student, house, teacher, reason"
                value={historyQuery}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              House
              <select
                className="field"
                onChange={(event) => setHistoryHouseFilter(event.target.value as "All" | HouseName)}
                value={historyHouseFilter}
              >
                <option value="All">All houses</option>
                {houses.map((house) => (
                  <option key={house} value={house}>
                    {house}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Date
              <input
                className="field"
                onChange={(event) => {
                  setHistoryDateFilter(event.target.value);
                  if (event.target.value) {
                    setHistoryDateRange("all");
                  }
                }}
                type="date"
                value={historyDateFilter}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Sort
              <select
                className="field"
                onChange={(event) => setHistorySort(event.target.value as "newest" | "oldest" | "points-high" | "points-low")}
                value={historySort}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="points-high">Points high to low</option>
                <option value="points-low">Points low to high</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Today", value: "today" as const },
              { label: "This Week", value: "week" as const },
              { label: "This Month", value: "month" as const },
            ].map((range) => (
              <button
                className={historyDateRange === range.value ? "button-primary" : "button-secondary"}
                key={range.value}
                onClick={() => {
                  setHistoryDateRange(range.value);
                  setHistoryDateFilter("");
                }}
                type="button"
              >
                {range.label}
              </button>
            ))}
            <button
              className="button-secondary"
              onClick={() => downloadCsv("housedeck-filtered-transactions.csv", transactionsToCsv(sortedTransactions, students))}
              type="button"
            >
              Export Filtered
            </button>
            <button
              className="button-secondary"
              onClick={() => {
                setHistoryQuery("");
                setHistoryHouseFilter("All");
                setHistoryDateFilter("");
                setHistoryDateRange("all");
                setHistorySort("newest");
              }}
              type="button"
            >
              Clear Filters
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Shown" note="Current filter" value={sortedTransactions.length.toString()} />
            <Metric label="Awarded" note="Positive points" value={filteredPositivePoints.toString()} />
            <Metric label="Deductions" note="Negative points" value={filteredDeductions.toString()} />
            <Metric label="Net" note="Combined total" value={filteredNetPoints.toString()} />
          </div>
          {sortedTransactions.length === 0 ? (
            <p className="text-sm text-white/55">No points have been recorded yet.</p>
          ) : (
            sortedTransactions.slice(0, 20).map((transaction) => {
              const student = students.find((item) => item.id === transaction.studentId);
              const subject = student
                ? `${student.firstName} ${student.lastName}`
                : transaction.house
                  ? `${transaction.house} House`
                  : "House";

              return (
                <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3" key={transaction.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{subject}</p>
                        <span className="font-mono text-sm text-white/60">{transaction.points > 0 ? `+${transaction.points}` : transaction.points}</span>
                      </div>
                      <p className="mt-1 text-sm text-white/55">
                        {transaction.category} by {transaction.teacher}
                      </p>
                      <p className="mt-1 text-sm text-white/45">
                        {transaction.reason} • {transaction.date}
                      </p>
                    </div>
                    <button
                      className="button-secondary disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isUndoingTransactionId === transaction.id}
                      onClick={() => onUndoTransaction(transaction)}
                      type="button"
                    >
                      {isUndoingTransactionId === transaction.id ? "Undoing..." : "Undo"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Panel>
      </div>
    </div>
  );
}

function DisplayHouseCard({
  gapFromLead,
  house,
  index,
  mascotImage,
}: {
  gapFromLead: number;
  house: HouseTotal;
  index: number;
  mascotImage: string | null;
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
      <div className="absolute inset-0 scale-105 bg-cover bg-center opacity-70 transition duration-700 group-hover:scale-110" style={{ backgroundImage: mascotImage ? `url('${mascotImage}')` : "url('/brand/houses.png')", backgroundPosition: mascotImage ? "center" : positionByHouse[house.house], backgroundSize: mascotImage ? "cover" : "200% 200%" }} />
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
  modal,
  onAddStudent,
  onClose,
  onImport,
  onUpdateStudent,
  setCsvDraft,
  setStudentDraft,
  studentDraft,
}: {
  csvDraft: string;
  modal: Modal;
  onAddStudent: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onImport: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateStudent: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>) => void;
  setCsvDraft: (value: string) => void;
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
      <button aria-label={`Close ${title}`} className="button-compact" onClick={onClose} type="button">Close</button>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  if (!message) return null;

  const tone = /could not|failed|expired|not found|missing|enter |choose |paste /i.test(message)
    ? "error"
    : /saved|signed|added|updated|approved|imported|undone|reset|archive|downloaded|assigned/i.test(message)
      ? "success"
      : "neutral";
  const accentClass =
    tone === "error"
      ? "text-red-300"
      : tone === "success"
        ? "text-emerald-300"
        : "text-white/70";
  const borderClass =
    tone === "error"
      ? "toast-error"
      : tone === "success"
        ? "toast-success"
        : "toast-neutral";

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      role="status"
      className={`toast-shell fixed bottom-24 right-4 z-40 max-w-[min(92vw,420px)] px-4 py-3 pl-7 text-sm text-white shadow-2xl shadow-black/40 lg:bottom-4 ${borderClass}`}
    >
      <span aria-hidden="true" className={`toast-accent ${accentClass}`} />
      <p className="font-semibold">
        {tone === "error" ? "Something needs attention" : tone === "success" ? "All set" : "Heads up"}
      </p>
      <p className="mt-1 text-white/78">{message}</p>
    </div>
  );
}

function MobileNavIcon({
  icon,
}: {
  icon: MobileNavIconName;
}) {
  const pathByIcon = {
    home: "M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    students: "M8 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM3 20a5 5 0 0 1 10 0Zm9 0a4 4 0 0 1 8 0Z",
    assign: "M5 5h14v4H5zM5 11h8v8H5zM15 13l2 2 4-4",
    scoreboard: "M5 19V9m7 10V5m7 14v-7",
    reports: "M6 4h9l3 3v13H6zM9 12h6M9 16h6M9 8h3",
    admin: "M12 3l2.2 2.1 3-.6.9 2.9 2.7 1.4-1.4 2.7 1.4 2.7-2.7 1.4-.9 2.9-3-.6L12 21l-2.2-2.1-3 .6-.9-2.9-2.7-1.4 1.4-2.7-1.4-2.7 2.7-1.4.9-2.9 3 .6ZM12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z",
    signout: "M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4m4-4 4-4m0 0-4-4m4 4H9",
  } satisfies Record<MobileNavIconName, string>;

  return (
    <svg aria-hidden="true" className="mobile-nav-icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d={pathByIcon[icon]} />
    </svg>
  );
}

function Panel({ action, children, title }: { action?: string; children: React.ReactNode; title: string }) {
  return (
    <section className="panel-shell p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action ? <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-medium text-white/50">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="metric-shell px-4 py-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white/55">{label}</p>
          <p className="mt-1 text-xs text-white/45">{note}</p>
        </div>
        <p className="metric-value-glow text-2xl font-semibold tracking-tight sm:text-3xl">{value}</p>
      </div>
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

function HouseRow({
  house,
  index,
  mascotImage,
  onClick,
}: {
  house: HouseTotal;
  index?: number;
  mascotImage?: string | null;
  onClick?: () => void;
}) {
  const content = (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 transition hover:border-white/20 hover:bg-black/30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {typeof index === "number" ? <span className="grid size-8 place-items-center rounded-lg bg-white/10 font-mono text-sm">{index + 1}</span> : null}
          {mascotImage ? (
            <img
              alt={`${house.house} mascot preview`}
              className="size-10 rounded-lg border border-white/10 object-cover"
              src={mascotImage}
            />
          ) : null}
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

  if (!onClick) {
    return content;
  }

  return (
    <button
      aria-label={`Open ${house.house} House transactions`}
      className="text-left"
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  );
}

function StudentList({
  onSelectStudent,
  students,
}: {
  onSelectStudent?: (student: Student) => void;
  students: Student[];
}) {
  return (
    <div className="grid gap-2">
      {students.map((student, index) => (
        <button
          aria-label={`Open transactions for ${student.firstName} ${student.lastName}`}
          className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3 text-left transition hover:border-white/20 hover:bg-black/30"
          key={student.id}
          onClick={() => onSelectStudent?.(student)}
          type="button"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-white/10 font-mono text-xs">{index + 1}</span>
            <div>
              <p className="font-medium">{student.firstName} {student.lastName}</p>
              <HouseBadge house={student.house} />
            </div>
          </div>
          <span className="font-mono font-semibold">{student.points}</span>
        </button>
      ))}
    </div>
  );
}

function ActivityList({
  onSelectTransaction,
  students = seedStudents,
  transactions,
}: {
  onSelectTransaction?: (transaction: Transaction) => void;
  students?: Student[];
  transactions: Transaction[];
}) {
  return (
    <div className="grid gap-2">
      {transactions.map((transaction) => {
        const student = students.find((item) => item.id === transaction.studentId);
        const subject = student
          ? `${student.firstName} ${student.lastName}`
          : transaction.house
            ? `${transaction.house} House`
            : "House";
        const content = (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 transition hover:border-white/20 hover:bg-black/30" key={transaction.id}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{subject}</p>
              <span className="font-mono text-sm font-semibold">{transaction.points > 0 ? `+${transaction.points}` : transaction.points}</span>
            </div>
            <p className="mt-1 text-sm text-white/55">{transaction.category} by {transaction.teacher} - {transaction.reason}</p>
          </div>
        );

        if (!onSelectTransaction) {
          return content;
        }

        return (
          <button
            aria-label={`Open transaction details for ${subject}, ${transaction.category}, ${transaction.teacher}`}
            className="text-left"
            key={transaction.id}
            onClick={() => onSelectTransaction(transaction)}
            type="button"
          >
            {content}
          </button>
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

function getHouseTotals(sourceStudents: Student[], sourceTransactions: Transaction[]): HouseTotal[] {
  const maxPoints = Math.max(
    1,
    ...houses.map((house) =>
      sourceStudents
        .filter((student) => student.house === house)
        .reduce((sum, student) => sum + student.points, 0) +
      sourceTransactions
        .filter((transaction) => transaction.house === house && !transaction.studentId)
        .reduce((sum, transaction) => sum + transaction.points, 0),
    ),
  );

  return houses
    .map((house) => {
      const houseStudents = sourceStudents.filter((student) => student.house === house);
      const studentPoints = houseStudents.reduce((sum, student) => sum + student.points, 0);
      const bonusPoints = sourceTransactions
        .filter((transaction) => transaction.house === house && !transaction.studentId)
        .reduce((sum, transaction) => sum + transaction.points, 0);
      const points = studentPoints + bonusPoints;
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
      const subject = student
        ? `${student.firstName} ${student.lastName}`
        : transaction.house
          ? `${transaction.house} House`
          : "House";
      return [
        transaction.date,
        subject,
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

function loadStoredMascots(): Record<HouseName, string | null> {
  if (typeof window === "undefined") {
    return {
      Red: null,
      Blue: null,
      Yellow: null,
      Green: null,
    };
  }

  const emptyMascots: Record<HouseName, string | null> = {
    Red: null,
    Blue: null,
    Yellow: null,
    Green: null,
  };

  const raw = window.localStorage.getItem(mascotStorageKey);
  if (!raw) return emptyMascots;

  try {
    const parsed = JSON.parse(raw) as Partial<Record<HouseName, string | null>>;
    return {
      Red: parsed.Red ?? null,
      Blue: parsed.Blue ?? null,
      Yellow: parsed.Yellow ?? null,
      Green: parsed.Green ?? null,
    };
  } catch {
    return emptyMascots;
  }
}

function storeMascots(mascots: Record<HouseName, string | null>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(mascotStorageKey, JSON.stringify(mascots));
}
