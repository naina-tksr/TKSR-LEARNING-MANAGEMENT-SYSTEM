// Shared types mirroring the API's camelCase response shapes.

export type Role = 'admin' | 'trainer' | 'student'
export type ProgramStatus = 'draft' | 'published'
export type Level = 'beginner' | 'intermediate' | 'advanced'
export type SubmissionStatus = 'submitted' | 'graded'

// Task & per-task grading
export type TaskFormat = 'text' | 'mixed' | 'url' | 'file'
export type TaskResponseStatus = 'pending' | 'awaiting_review' | 'assessed'

export interface AssignmentTask {
  id: number
  assignmentId: number
  position: number
  prompt: string
  format: TaskFormat
  required: boolean
  maxMarks: number
}

export interface TaskResponse {
  id: number
  submissionId: number
  taskId: number
  responseText: string
  score: number | null
  feedback: string | null
  status: TaskResponseStatus
  reviewedBy: number | null
  reviewedAt: string | null
  updatedAt: string
}

export interface TaskCompletion {
  hasTasks: boolean
  complete: boolean
  requiredTotal: number
  requiredAssessed: number
  outstanding: { taskId: number; prompt: string; status: TaskResponseStatus; required: boolean }[]
}

// Extended assignment with tasks
export interface AssignmentWithTasks extends Assignment {
  tasks: AssignmentTask[]
  myTaskResponses?: TaskResponse[]
}

// Extended submission detail with tasks
export interface SubmissionDetailWithTasks extends SubmissionDetail {
  tasks: AssignmentTask[]
  taskResponses: TaskResponse[]
  taskCompletion: TaskCompletion
}

// Live classes
export type LiveClassStatus = 'draft' | 'scheduled' | 'cancelled'

export interface LiveClass {
  id: number
  programId: number
  moduleId: number | null
  title: string
  classDate: string
  startTime: string
  timezone: string
  durationMinutes: number
  meetUrl: string | null
  trainerId: number | null
  instructions: string
  status: LiveClassStatus
  createdBy: number | null
  createdAt: string
  updatedAt: string
  moduleTitle?: string | null
  trainerName?: string | null
}

export interface CreateLiveClassInput {
  title: string
  classDate: string
  startTime: string
  timezone: string
  durationMinutes?: number
  meetUrl: string
  moduleId?: number | null
  instructions?: string
  status?: 'draft' | 'scheduled'
}

export interface UpdateLiveClassInput {
  title?: string
  classDate?: string
  startTime?: string
  timezone?: string
  durationMinutes?: number
  meetUrl?: string
  moduleId?: number | null
  instructions?: string
  status?: LiveClassStatus
}

// Certificates
export type CertificateKind = '1_day_project' | '7_day_project' | 'general'

export interface Certificate {
  id: number
  studentId: number
  programId: number
  certificateId: string
  certificateType: string
  certificateTitle: string
  studentName: string
  programTitle: string
  completionDate: string
  signatoryName: string | null
  signatoryTitle: string | null
  verificationCode: string
  verificationUrl: string
  downloadUrl: string
  issuedAt: string
}

// Eligibility report for a student's enrolled program
export interface ProgramEligibility {
  programId: number
  programTitle: string
  eligible: boolean
  enrolled: boolean
  certificateEnabled: boolean
  certificateIssued: boolean
  certificate: Certificate | null
  lessons: { total: number; completed: number; percent: number; satisfied: boolean }
  assignments: { total: number; satisfied: boolean; items?: unknown[] }
  finalAssessment: { id: number; title: string; graded: boolean; percent: number | null } | null
  reasons: string[]
}

// Staff view: student with certificate status
export interface ProgramStudentCertificate {
  studentId: number
  name: string
  email: string
  eligible: boolean
  certificateIssued: boolean
  certificateId: string | null
  reasons: string[]
}

export interface EligibilityReport {
  eligible: boolean
  reason: string | null
  rules: {
    programKind: string
    passingPercent: number
    requireAllModules: boolean
    requireAllAssignments: boolean
    requireFinalAssessment: boolean
    finalAssignmentId: number | null
    signatoryName: string | null
    signatoryTitle: string | null
    certificateEnabled: boolean
    certificateType: string
  }
  checks: {
    enrolled: boolean
    modulesComplete: boolean
    assignmentsComplete: boolean
    finalAssessmentPassed: boolean
    trainerApproved: boolean
  }
}

export interface CompletionRules {
  programKind: string
  passingPercent: number
  requireAllModules: boolean
  requireAllAssignments: boolean
  requireFinalAssessment: boolean
  finalAssignmentId: number | null
  signatoryName: string | null
  signatoryTitle: string | null
  certificateEnabled: boolean
  certificateType: string
}

export interface User {
  id: number
  name: string
  email: string
  role: Role
  status: 'active' | 'disabled'
  createdAt?: string
  lastLoginAt?: string | null
}

export interface PageMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  data: T[]
  meta: PageMeta
}

export interface Progress {
  totalLessons: number
  completedLessons: number
  percent: number
}

export interface ProgramListItem {
  id: number
  title: string
  description: string
  level: Level
  status: ProgramStatus
  trainerId: number | null
  trainerName: string | null
  moduleCount: number
  lessonCount: number
  studentCount: number
  createdAt: string
  updatedAt: string
  // present for students (joined progress)
  totalLessons?: number
  completedLessons?: number
  percent?: number
}

export interface Lesson {
  id: number
  moduleId: number
  title: string
  content: string
  position: number
  durationMinutes: number
  completed: boolean
}

export interface Module {
  id: number
  title: string
  description: string
  position: number
  lessons: Lesson[]
  progress?: Progress
}

export interface RubricItem {
  id?: number
  criteria: string
  description: string
  maxMarks: number
  position?: number
}

export interface MySubmissionSummary {
  id: number
  status: SubmissionStatus
  score: number | null
  isLate: boolean
  submittedAt: string
}

export interface Assignment {
  id: number
  programId: number
  title: string
  description: string
  maxMarks: number
  dueAt: string | null
  status: ProgramStatus
  moduleId: number | null
  createdAt: string
  rubricItems: RubricItem[]
  submissionCount?: number
  gradedCount?: number
  mySubmission?: MySubmissionSummary | null
}

export interface ProgramDetail {
  program: {
    id: number
    title: string
    description: string
    level: Level
    status: ProgramStatus
    trainerId: number | null
    trainer?: { id: number; name: string; email: string } | null
    createdAt: string
    updatedAt: string
  }
  access: 'admin' | 'trainer' | 'student'
  modules: Module[]
  assignments: Assignment[]
  cohorts: { id: number; name: string; startDate: string | null; endDate: string | null; studentCount: number }[]
  progress?: Progress
}

export interface SubmissionListItem {
  id: number
  assignmentId: number
  status: SubmissionStatus
  score: number | null
  isLate: boolean
  attempts: number
  submittedAt: string
  gradedAt: string | null
  studentId?: number
  studentName?: string
  studentEmail?: string
  assignmentTitle?: string
  maxMarks?: number
  programTitle?: string
}

export interface Evaluation {
  id: number
  submissionId: number
  source: 'ai' | 'trainer'
  provider: string | null
  suggestedScore: number | null
  strengths: string
  weaknesses: string
  suggestionFeedback: string
  status: 'suggested' | 'accepted' | 'edited' | 'dismissed'
  reviewedBy: number | null
  reviewedByName?: string | null
  createdAt: string
}

export interface SubmissionDetail {
  submission: {
    id: number
    assignmentId: number
    studentId: number
    status: SubmissionStatus
    content: string
    url: string | null
    fileName: string | null
    fileSize: number | null
    score: number | null
    feedback: string | null
    isLate: boolean
    attempts: number
    submittedAt: string
    gradedAt: string | null
  }
  assignment: Assignment
  program: { id: number; title: string; status: ProgramStatus }
  student: { id: number; name: string; email: string } | null
  gradedBy: { id: number; name: string } | null
  evaluations: Evaluation[]
  canGrade: boolean
}

export interface Notification {
  id: number
  title: string
  body: string
  type: string
  link: string | null
  readAt: string | null
  createdAt: string
}

export interface AuditEntry {
  id: number
  action: string
  entityType: string | null
  entityId: number | null
  userName: string | null
  ip: string | null
  createdAt: string
}

export interface Conversation {
  id: number
  title: string
  createdAt: string
  updatedAt: string
}

export interface AiMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface Cohort {
  id: number
  programId: number
  name: string
  startDate: string | null
  endDate: string | null
  studentCount: number
  programTitle?: string
}

export interface ProgramStudent {
  id: number
  name: string
  email: string
  cohortId: number
  cohortName: string
  enrolledAt: string
  progress: Progress
}

export interface StudentAssignmentRow {
  id: number
  title: string
  description: string
  maxMarks: number
  dueAt: string | null
  programId: number
  programTitle: string
  submissionId: number | null
  submissionStatus: SubmissionStatus | null
  score: number | null
  isLate: boolean
  submittedAt: string | null
  gradedAt: string | null
  feedback: string | null
  isSubmitted: boolean
  isOverdue: boolean
}

export interface StudentProgramRow {
  id: number
  title: string
  description: string
  level: Level
  trainerName: string | null
  cohortNames: string[]
  progress: Progress
  nextLesson: {
    lessonId: number
    lessonTitle: string
    moduleId: number
    moduleTitle: string
    completed: boolean
  } | null
}

// Dashboard payloads (role-composed server-side)
export interface StudentDashboard {
  stats: {
    programs: number
    overallProgress: number
    completedLessons: number
    totalLessons: number
    pendingAssignments: number
    gradedCount: number
  }
  programs: (StudentProgramRow & { level: Level; description: string })[]
  continueLearning: {
    id: number
    title: string
    nextLesson: StudentProgramRow['nextLesson']
  } | null
  pendingAssignments: {
    id: number
    title: string
    maxMarks: number
    dueAt: string | null
    programTitle: string
    programId: number
    isOverdue: boolean
  }[]
  recentGrades: {
    id: number
    score: number
    feedback: string
    gradedAt: string
    isLate: boolean
    assignmentId: number
    assignmentTitle: string
    maxMarks: number
  }[]
}

export interface TrainerDashboard {
  stats: { programs: number; students: number; pendingSubmissions: number; assignments: number }
  programs: {
    id: number
    title: string
    status: ProgramStatus
    level: Level
    moduleCount: number
    studentCount: number
  }[]
  assignments: {
    id: number
    title: string
    dueAt: string | null
    status: ProgramStatus
    maxMarks: number
    programTitle: string
    submissionCount: number
    gradedCount: number
  }[]
  recentSubmissions: SubmissionListItem[]
}

export interface AdminDashboard {
  stats: {
    users: { total: number; trainers: number; students: number; active: number }
    programs: { total: number; published: number; draft: number }
    enrollments: { total: number; cohorts: number; students: number }
    submissions: { pending: number; graded: number }
  }
  recentUsers: User[]
  recentActivity: {
    id: number
    action: string
    entityType: string
    createdAt: string
    userName: string
  }[]
}
