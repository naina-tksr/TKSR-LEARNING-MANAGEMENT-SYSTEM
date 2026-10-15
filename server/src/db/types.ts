export type Role = 'admin' | 'trainer' | 'student'

export interface RoleRow {
  id: number
  name: Role
  description: string
}

export interface UserRow {
  id: number
  name: string
  email: string
  password_hash: string
  role_id: number
  status: 'active' | 'disabled'
  created_at: string
  updated_at: string
}

export interface ProgramRow {
  id: number
  title: string
  description: string
  level: 'beginner' | 'intermediate' | 'advanced'
  status: 'draft' | 'published'
  trainer_id: number | null
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface CohortRow {
  id: number
  program_id: number
  name: string
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

export interface EnrollmentRow {
  id: number
  cohort_id: number
  student_id: number
  status: 'active' | 'completed' | 'dropped'
  enrolled_by: number | null
  enrolled_at: string
  updated_at: string
}

export interface ModuleRow {
  id: number
  program_id: number
  title: string
  description: string
  position: number
  created_at: string
  updated_at: string
}

export interface LessonRow {
  id: number
  module_id: number
  title: string
  content: string
  position: number
  duration_minutes: number
  created_at: string
  updated_at: string
}

export interface AssignmentRow {
  id: number
  program_id: number
  module_id: number | null
  title: string
  description: string
  max_marks: number
  due_at: string | null
  status: 'draft' | 'published'
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface RubricItemRow {
  id: number
  assignment_id: number
  criteria: string
  description: string
  max_marks: number
  position: number
}

export interface SubmissionRow {
  id: number
  assignment_id: number
  student_id: number
  content: string
  url: string | null
  file_path: string | null
  file_name: string | null
  file_size: number | null
  file_mime: string | null
  status: 'submitted' | 'graded'
  is_late: number
  attempts: number
  score: number | null
  feedback: string | null
  graded_by: number | null
  graded_at: string | null
  submitted_at: string
  created_at: string
  updated_at: string
}

export interface EvaluationRow {
  id: number
  submission_id: number
  source: 'ai' | 'trainer'
  suggested_score: number | null
  strengths: string
  weaknesses: string
  suggestion_feedback: string
  status: 'suggested' | 'accepted' | 'edited' | 'rejected'
  provider: string | null
  created_by: number | null
  reviewed_by: number | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface NotificationRow {
  id: number
  user_id: number
  title: string
  body: string
  type: 'info' | 'grade' | 'assignment' | 'enrollment' | 'system'
  link: string | null
  read_at: string | null
  created_at: string
}

export interface AiConversationRow {
  id: number
  user_id: number
  title: string
  program_id: number | null
  created_at: string
  updated_at: string
}

export interface AiMessageRow {
  id: number
  conversation_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface AuditLogRow {
  id: number
  user_id: number | null
  action: string
  entity_type: string
  entity_id: string | null
  metadata: string
  ip: string | null
  created_at: string
}

export type ProgramKind = 'standard' | 'one_day_project' | 'seven_day_project'

export interface ProgramCompletionRulesRow {
  program_id: number
  program_kind: ProgramKind
  certificate_enabled: number
  certificate_type: string
  passing_percent: number
  require_all_modules: number
  require_all_assignments: number
  require_final_assessment: number
  final_assignment_id: number | null
  require_trainer_approval: number
  signatory_name: string
  signatory_title: string
  created_at: string
  updated_at: string
}

export type LiveClassStatus = 'draft' | 'scheduled' | 'cancelled'

export interface LiveClassRow {
  id: number
  program_id: number
  module_id: number | null
  title: string
  class_date: string
  start_time: string
  timezone: string
  duration_minutes: number
  meet_url: string | null
  trainer_id: number | null
  instructions: string
  status: 'draft' | 'scheduled' | 'cancelled'
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface AssignmentTaskRow {
  id: number
  assignment_id: number
  position: number
  prompt: string
  format: 'text' | 'mixed' | 'url' | 'file'
  required: number
  max_marks: number
  created_at: string
  updated_at: string
}

export type TaskResponseStatus = 'pending' | 'answered' | 'awaiting_review' | 'assessed'

export interface TaskResponseRow {
  id: number
  submission_id: number
  task_id: number
  response_text: string
  status: TaskResponseStatus
  score: number | null
  feedback: string | null
  reviewed_by: number | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface ProjectApprovalRow {
  id: number
  student_id: number
  program_id: number
  approved_by: number | null
  approved_at: string
  note: string
  created_at: string
  updated_at: string
}

export interface CertificateRow {
  id: number
  certificate_id: string
  verification_code: string
  student_id: number
  program_id: number
  certificate_type: string
  certificate_title: string
  student_name: string
  program_title: string
  completion_date: string
  signatory_name: string
  signatory_title: string
  issued_by: number | null
  metadata: string
  issued_at: string
  created_at: string
}
