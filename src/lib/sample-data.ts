export type HouseName = "Red" | "Blue" | "Yellow" | "Green";

export type Student = {
  id: string;
  firstName: string;
  lastName: string;
  grade: number;
  familyId?: string;
  house: HouseName;
  points: number;
};

export type Transaction = {
  id: string;
  studentId: string;
  points: number;
  category: string;
  reason: string;
  teacher: string;
  date: string;
};

export const houseStyles: Record<
  HouseName,
  { hex: string; soft: string; text: string; ring: string }
> = {
  Red: {
    hex: "#e23b3b",
    soft: "#fff0f0",
    text: "#b51f24",
    ring: "rgba(226, 59, 59, 0.22)",
  },
  Blue: {
    hex: "#3478f6",
    soft: "#eef4ff",
    text: "#1e55c9",
    ring: "rgba(52, 120, 246, 0.2)",
  },
  Yellow: {
    hex: "#f2b705",
    soft: "#fff7dc",
    text: "#946900",
    ring: "rgba(242, 183, 5, 0.22)",
  },
  Green: {
    hex: "#22a06b",
    soft: "#eaf8f2",
    text: "#13764c",
    ring: "rgba(34, 160, 107, 0.2)",
  },
};

export const students: Student[] = [
  { id: "stu-1", firstName: "Mia", lastName: "Miller", grade: 8, house: "Yellow", points: 93 },
  { id: "stu-2", firstName: "Amelia", lastName: "Taylor", grade: 7, house: "Blue", points: 85 },
  { id: "stu-3", firstName: "Evelyn", lastName: "Jackson", grade: 8, familyId: "FAM006", house: "Red", points: 80 },
  { id: "stu-4", firstName: "William", lastName: "Brown", grade: 5, familyId: "FAM003", house: "Green", points: 80 },
  { id: "stu-5", firstName: "Olivia", lastName: "Smith", grade: 6, familyId: "FAM002", house: "Blue", points: 72 },
  { id: "stu-6", firstName: "Sophia", lastName: "Brown", grade: 7, familyId: "FAM003", house: "Green", points: 70 },
  { id: "stu-7", firstName: "Harper", lastName: "Thomas", grade: 5, house: "Green", points: 60 },
  { id: "stu-8", firstName: "Ava", lastName: "Williams", grade: 7, house: "Yellow", points: 55 },
  { id: "stu-9", firstName: "Charlotte", lastName: "Wilson", grade: 6, familyId: "FAM005", house: "Red", points: 50 },
  { id: "stu-10", firstName: "Emma", lastName: "Johnson", grade: 5, familyId: "FAM001", house: "Red", points: 45 },
  { id: "stu-11", firstName: "Benjamin", lastName: "Anderson", grade: 3, house: "Yellow", points: 42 },
  { id: "stu-12", firstName: "Noah", lastName: "Smith", grade: 4, familyId: "FAM002", house: "Blue", points: 38 },
  { id: "stu-13", firstName: "Henry", lastName: "White", grade: 4, house: "Yellow", points: 35 },
  { id: "stu-14", firstName: "Ethan", lastName: "Davis", grade: 5, house: "Green", points: 33 },
  { id: "stu-15", firstName: "Liam", lastName: "Johnson", grade: 3, familyId: "FAM001", house: "Red", points: 30 },
  { id: "stu-16", firstName: "Isabella", lastName: "Garcia", grade: 4, familyId: "FAM004", house: "Blue", points: 25 },
  { id: "stu-17", firstName: "Lucas", lastName: "Jackson", grade: 6, familyId: "FAM006", house: "Red", points: 25 },
  { id: "stu-18", firstName: "James", lastName: "Jones", grade: 6, house: "Red", points: 22 },
  { id: "stu-19", firstName: "Mason", lastName: "Garcia", grade: 2, familyId: "FAM004", house: "Blue", points: 20 },
  { id: "stu-20", firstName: "Alexander", lastName: "Wilson", grade: 4, familyId: "FAM005", house: "Red", points: 18 },
  { id: "stu-21", firstName: "Bob", lastName: "Barker", grade: 5, house: "Yellow", points: 10 },
];

export const transactions: Transaction[] = [
  { id: "tx-1", studentId: "stu-2", points: 10, category: "Positive Behavior", reason: "Great hallway leadership", teacher: "Micah Gooden", date: "2026-06-27" },
  { id: "tx-2", studentId: "stu-19", points: 10, category: "Positive Behavior", reason: "Helped a classmate", teacher: "Micah Gooden", date: "2026-06-27" },
  { id: "tx-3", studentId: "stu-16", points: 10, category: "Positive Behavior", reason: "Strong participation", teacher: "Micah Gooden", date: "2026-06-27" },
  { id: "tx-4", studentId: "stu-12", points: 10, category: "Positive Behavior", reason: "Excellent focus", teacher: "Micah Gooden", date: "2026-06-27" },
  { id: "tx-5", studentId: "stu-5", points: 10, category: "Positive Behavior", reason: "Supported group work", teacher: "Micah Gooden", date: "2026-06-27" },
  { id: "tx-6", studentId: "stu-4", points: 10, category: "Positive Behavior", reason: "Classroom leadership", teacher: "Teacher", date: "2026-06-24" },
  { id: "tx-7", studentId: "stu-1", points: 5, category: "Participation", reason: "Music competition", teacher: "Teacher", date: "2026-06-20" },
];
