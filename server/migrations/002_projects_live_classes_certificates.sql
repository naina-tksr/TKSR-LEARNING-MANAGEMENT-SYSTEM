-- TKSR Learning - projects (1-Day / 7-Day), live classes, per-task grading,
-- project approvals and personalized completion certificates.
-- All timestamps are ISO-8601 UTC strings.

-- ---------------------------------------------------------------------------
-- Program completion + certificate configuration (one row per program)
-- ---------------------------------------------------------------------------
CREATE TABLE program_completion_rules (
  program_id INTEGER PRIMARY KEY REFERENCES programs(id) ON DELETE CASCADE,
  program_kind TEXT NOT NULL DEFAULT 'standard'
    CHECK (program_kind IN ('standard', 'one_day_project', 'seven_day_project')),
  certificate_enabled INTEGER NOT NULL DEFAULT 0 CHECK (certificate_enabled IN (0, 1)),
  certificate_type TEXT NOT NULL DEFAULT 'Completion',
  passing_percent INTEGER NOT NULL DEFAULT 0 CHECK (passing_percent BETWEEN 0 AND 100),
  require_all_modules INTEGER NOT NULL DEFAULT 1 CHECK (require_all_modules IN (0, 1)),
  require_all_assignments INTEGER NOT NULL DEFAULT 1 CHECK (require_all_assignments IN (0, 1)),
  require_final_assessment INTEGER NOT NULL DEFAULT 0 CHECK (require_final_assessment IN (0, 1)),
  final_assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  require_trainer_approval INTEGER NOT NULL DEFAULT 0 CHECK (require_trainer_approval IN (0, 1)),
  signatory_name TEXT NOT NULL DEFAULT 'TKSR Learning',
  signatory_title TEXT NOT NULL DEFAULT 'Director of Learning',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_pcr_kind ON program_completion_rules(program_kind);

-- ---------------------------------------------------------------------------
-- Live classes (manually configured Google Meet links; API-ready design)
-- ---------------------------------------------------------------------------
CREATE TABLE live_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  class_date TEXT NOT NULL,                                  -- YYYY-MM-DD
  start_time TEXT NOT NULL,                                  -- HH:MM (24h)
  timezone TEXT NOT NULL DEFAULT 'UTC',
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0 AND duration_minutes <= 600),
  meet_url TEXT,
  trainer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_live_classes_program ON live_classes(program_id, class_date);
CREATE INDEX idx_live_classes_trainer ON live_classes(trainer_id);
CREATE INDEX idx_live_classes_status ON live_classes(status);

-- ---------------------------------------------------------------------------
-- Per-task assessment (fixes BUG-01/02/03: strict task completeness + scores)
-- ---------------------------------------------------------------------------
CREATE TABLE assignment_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'text' CHECK (format IN ('text', 'mixed', 'url', 'file')),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  max_marks INTEGER NOT NULL CHECK (max_marks > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_assignment_tasks_assignment ON assignment_tasks(assignment_id, position);

CREATE TABLE task_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES assignment_tasks(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'awaiting_review', 'assessed')),
  score INTEGER CHECK (score IS NULL OR score >= 0),
  feedback TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_task_responses_submission_task ON task_responses(submission_id, task_id);
CREATE INDEX idx_task_responses_submission ON task_responses(submission_id);

-- ---------------------------------------------------------------------------
-- Trainer/admin approval of a student's project (used by completion rules)
-- ---------------------------------------------------------------------------
CREATE TABLE project_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_project_approvals_student_program ON project_approvals(student_id, program_id);

-- ---------------------------------------------------------------------------
-- Issued certificates (one per student/program; unique public ID)
-- ---------------------------------------------------------------------------
CREATE TABLE certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_id TEXT NOT NULL UNIQUE,
  verification_code TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  certificate_type TEXT NOT NULL,
  certificate_title TEXT NOT NULL,
  student_name TEXT NOT NULL,
  program_title TEXT NOT NULL,
  completion_date TEXT NOT NULL,
  signatory_name TEXT NOT NULL,
  signatory_title TEXT NOT NULL,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_certificates_student_program ON certificates(student_id, program_id);
CREATE INDEX idx_certificates_student ON certificates(student_id);
CREATE INDEX idx_certificates_program ON certificates(program_id);
