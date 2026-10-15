import { get, run } from './helpers.js'

/**
 * Seeds the two project programs used by the completion-certificate flow:
 *   - "1-Day Project Program"   (program_kind = one_day_project)
 *   - "7-Day Project Program"   (program_kind = seven_day_project)
 *
 * Idempotent: if a program with the same title already exists it is left alone,
 * so the seeder can safely run alongside the main demo seed.
 */

interface ProjectSeedOptions {
  trainerId: number
  adminId: number
  studentIds: number[]
}

interface TaskSpec {
  prompt: string
  format: 'text' | 'mixed' | 'url' | 'file'
  maxMarks: number
}

interface DaySpec {
  title: string
  description: string
  objectives: string[]
  tasks: TaskSpec[]
}

function addDays(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function meetLink(index: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const pick = (length: number, offset: number) =>
    Array.from({ length }, (_, i) => alphabet[(i * 3 + offset + index * 5) % 26]).join('')
  return `https://meet.google.com/${pick(3, 0)}-${pick(4, 4)}-${pick(3, 9)}`
}

function lessonContent(day: DaySpec, objective: string): string {
  return [
    `## ${objective}`,
    '',
    `Part of **${day.title}**.`,
    '',
    '### What you will do',
    `- Read the concept and the worked example for "${objective}".`,
    '- Follow the practical steps during the live class.',
    '- Complete the day\'s practical task and submit it for trainer review.',
    '',
    '> Reminder: completing a lesson only marks reading progress. The certificate is',
    '> unlocked by the graded tasks, the live-class attendance (recorded manually) and',
    '> the final project assessment.',
  ].join('\n')
}

function createProjectProgram(
  options: ProjectSeedOptions,
  config: {
    title: string
    description: string
    level: 'beginner' | 'intermediate' | 'advanced'
    kind: 'one_day_project' | 'seven_day_project'
    certificateType: string
    days: DaySpec[]
  },
): void {
  if (get<{ id: number }>('SELECT id FROM programs WHERE title = ?', config.title)) return

  const programId = Number(
    run(
      `INSERT INTO programs (title, description, level, status, trainer_id, created_by)
       VALUES (?, ?, ?, 'published', ?, ?)`,
      config.title,
      config.description,
      config.level,
      options.trainerId,
      options.adminId,
    ).lastInsertRowid,
  )

  const cohortId = Number(
    run(
      'INSERT INTO cohorts (program_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
      programId,
      `${config.title} — Cohort 1`,
      addDays(1),
      addDays(config.days.length + 7),
    ).lastInsertRowid,
  )
  for (const studentId of options.studentIds) {
    run(
      'INSERT OR IGNORE INTO enrollments (cohort_id, student_id, enrolled_by) VALUES (?, ?, ?)',
      cohortId,
      studentId,
      options.adminId,
    )
  }

  let finalAssignmentId: number | null = null

  config.days.forEach((day, index) => {
    const moduleId = Number(
      run(
        'INSERT INTO modules (program_id, title, description, position) VALUES (?, ?, ?, ?)',
        programId,
        day.title,
        day.description,
        index,
      ).lastInsertRowid,
    )

    day.objectives.forEach((objective, lessonIndex) => {
      run(
        `INSERT INTO lessons (module_id, title, content, position, duration_minutes)
         VALUES (?, ?, ?, ?, ?)`,
        moduleId,
        objective,
        lessonContent(day, objective),
        lessonIndex,
        15,
      )
    })

    run(
      `INSERT INTO live_classes
         (program_id, module_id, title, class_date, start_time, timezone, duration_minutes,
          meet_url, trainer_id, instructions, status, created_by)
       VALUES (?, ?, ?, ?, '18:30', 'Asia/Kolkata', 60, ?, ?, ?, 'scheduled', ?)`,
      programId,
      moduleId,
      `${day.title} — live class`,
      addDays(index + 1),
      meetLink(index),
      options.trainerId,
      'Join five minutes early. Bring your questions and your in-progress work.',
      options.adminId,
    )

    const maxMarks = day.tasks.reduce((sum, task) => sum + task.maxMarks, 0)
    const assignmentId = Number(
      run(
        `INSERT INTO assignments (program_id, module_id, title, description, max_marks, due_at, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'published', ?)`,
        programId,
        moduleId,
        `${day.title} — submission`,
        day.description,
        maxMarks,
        `${addDays(index + 2)}T18:30:00.000Z`,
        options.trainerId,
      ).lastInsertRowid,
    )
    day.tasks.forEach((task, position) => {
      run(
        `INSERT INTO assignment_tasks (assignment_id, position, prompt, format, required, max_marks)
         VALUES (?, ?, ?, ?, 1, ?)`,
        assignmentId,
        position,
        task.prompt,
        task.format,
        task.maxMarks,
      )
    })

    if (index === config.days.length - 1) finalAssignmentId = assignmentId
  })

  run(
    `INSERT INTO program_completion_rules
       (program_id, program_kind, certificate_enabled, certificate_type, passing_percent,
        require_all_modules, require_all_assignments, require_final_assessment, final_assignment_id,
        require_trainer_approval, signatory_name, signatory_title)
     VALUES (?, ?, 1, ?, 60, 1, 1, 1, ?, 0, 'TKSR Learning', 'Director of Learning')`,
    programId,
    config.kind,
    config.certificateType,
    finalAssignmentId,
  )
}

const ONE_DAY: DaySpec[] = [
  {
    title: 'Day 1: Build and submit your first data project',
    description: 'A one-day, hands-on project: load a dataset, clean it, answer a business question and submit your work.',
    objectives: [
      'Welcome, project brief and success criteria',
      'Setting up Python with pandas and Jupyter',
      'Loading, cleaning and exploring a dataset',
      'Answering the project question and preparing your submission',
    ],
    tasks: [
      { prompt: 'Submit your notebook or a GitHub repository URL with your completed project', format: 'url', maxMarks: 40 },
      { prompt: 'Explain your approach, the cleaning steps and your key findings', format: 'text', maxMarks: 40 },
      { prompt: 'Attach a screenshot or exported chart of your final output', format: 'file', maxMarks: 20 },
    ],
  },
]

const SEVEN_DAY: DaySpec[] = [
  {
    title: 'Day 1: Project introduction, Python setup and OHLCV stock data',
    description: 'Understand the AI stock-ranking project, set up your environment and learn the OHLCV data model.',
    objectives: [
      'Project brief, scope and the seven-day roadmap',
      'Installing Python, pandas, NumPy and a notebook environment',
      'What OHLCV (Open, High, Low, Close, Volume) means',
      'Downloading and inspecting your first stock dataset',
    ],
    tasks: [
      { prompt: 'Paste your environment setup (Python version and pandas/NumPy versions)', format: 'text', maxMarks: 50 },
      { prompt: 'Explain OHLCV and why each field matters for ranking', format: 'text', maxMarks: 50 },
    ],
  },
  {
    title: 'Day 2: Fetching and validating stock data',
    description: 'Build a reliable data ingestion path and validate the data before analysis.',
    objectives: [
      'Fetching data from a market data source (or a provided CSV)',
      'Validating schema, date ranges and missing values',
      'Handling duplicates, splits and gaps',
    ],
    tasks: [
      { prompt: 'Share the function you use to fetch or load stock data', format: 'text', maxMarks: 50 },
      { prompt: 'List two data-quality checks you applied and the results', format: 'text', maxMarks: 50 },
    ],
  },
  {
    title: 'Day 3: Technical indicators with Pandas and NumPy',
    description: 'Compute moving averages, RSI and other indicators with pandas and NumPy.',
    objectives: [
      'Rolling windows and moving averages with pandas',
      'Relative Strength Index (RSI) and momentum',
      'Moving-average crossovers and volatility measures',
    ],
    tasks: [
      { prompt: 'Paste the code for two technical indicators you implemented', format: 'text', maxMarks: 50 },
      { prompt: 'Explain how each indicator is calculated and what it signals', format: 'text', maxMarks: 50 },
    ],
  },
  {
    title: 'Day 3: Bullish/bearish scoring and stock ranking (part 2)',
    description: 'Combine indicators into a bullish/bearish score and rank the universe of stocks.',
    objectives: [
      'Designing a transparent bullish/bearish scoring formula',
      'Ranking stocks and reviewing the top results',
      'Safeguarding against look-ahead bias',
    ],
    tasks: [
      { prompt: 'Show the scoring formula that turns indicators into a bullish/bearish score', format: 'mixed', maxMarks: 50 },
      { prompt: 'Attach or paste your ranked top-5 output for a chosen date', format: 'mixed', maxMarks: 50 },
    ],
  },
  {
    title: 'Day 5: LLM integration and structured analysis',
    description: 'Use an LLM to turn the quantitative ranking into structured, human-readable analysis.',
    objectives: [
      'Prompt design for structured stock analysis',
      'Validating and parsing the LLM JSON response',
      'Keeping the LLM grounded in the quantitative signals',
    ],
    tasks: [
      { prompt: 'Paste your prompt and a sample structured LLM output', format: 'mixed', maxMarks: 60 },
      { prompt: 'Explain how you validate the LLM response before using it', format: 'text', maxMarks: 40 },
    ],
  },
  {
    title: 'Day 6: Streamlit dashboard and testing',
    description: 'Wrap the analysis in an interactive Streamlit dashboard and test it.',
    objectives: [
      'Building a Streamlit UI for the ranked list',
      'Adding charts and per-stock detail',
      'Writing tests for your ranking logic',
    ],
    tasks: [
      { prompt: 'Share your Streamlit app code or repository link', format: 'url', maxMarks: 60 },
      { prompt: 'List the tests you ran and their results', format: 'text', maxMarks: 40 },
    ],
  },
  {
    title: 'Day 7: Final project submission, demonstration and evaluation',
    description: 'Submit the complete project, demonstrate it and receive the trainer evaluation.',
    objectives: [
      'Preparing your final repository and README',
      'Recording a short project demonstration',
      'Presenting results and receiving evaluation',
    ],
    tasks: [
      { prompt: 'Submit your final project repository or notebook', format: 'url', maxMarks: 50 },
      { prompt: 'Attach a link to a short demo recording or walkthrough', format: 'url', maxMarks: 30 },
      { prompt: 'Summarise your results, limitations and learnings', format: 'text', maxMarks: 20 },
    ],
  },
]

export function seedProjectPrograms(options: ProjectSeedOptions): void {
  createProjectProgram(options, {
    title: '1-Day Project Program',
    description:
      'A focused one-day, hands-on data project. Attend the live class, complete the practical task and submit a passing final project to earn the 1-Day Project Completion Certificate.',
    level: 'beginner',
    kind: 'one_day_project',
    certificateType: '1-Day Project Completion',
    days: ONE_DAY,
  })

  createProjectProgram(options, {
    title: '7-Day Project Program',
    description:
      'A seven-day guided build of an AI stock-ranking project: from OHLCV data to indicators, scoring, LLM analysis and a Streamlit dashboard. All seven days and the final project assessment are required for the 7-Day Project Completion Certificate.',
    level: 'intermediate',
    kind: 'seven_day_project',
    certificateType: '7-Day Project Completion',
    days: SEVEN_DAY,
  })
}
