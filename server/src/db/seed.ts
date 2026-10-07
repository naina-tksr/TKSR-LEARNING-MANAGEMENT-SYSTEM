import { config } from '../config.js'
import { hashPassword } from '../middleware/auth.js'
import { all, closeDatabase, exec, get, initDatabase, run, tx } from './helpers.js'
import { runMigrations } from './migrate.js'

/**
 * Seeds realistic demo data:
 *   1 admin, 2 trainers, 5 students, 1 AI training program (4 modules,
 *   13 lessons), 3 published assignments with rubrics, 2 cohorts,
 *   enrollments, progress, submissions, grades, AI evaluations,
 *   an AI tutor conversation, notifications and audit history.
 *
 * Usage:
 *   npm run db:seed              # seeds an empty database
 *   npm run db:seed -- --reset   # wipes and re-seeds
 */

const RESET = process.argv.includes('--reset')
const DAY = 24 * 60 * 60 * 1000

function iso(offsetMs: number, base = Date.now()): string {
  return new Date(base + offsetMs).toISOString()
}

function insertUser(name: string, email: string, passwordHash: string, roleId: number): number {
  return run('INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)', name, email, passwordHash, roleId)
    .lastInsertRowid
}

function insertLesson(moduleId: number, title: string, content: string, position: number, minutes: number): number {
  return run(
    'INSERT INTO lessons (module_id, title, content, position, duration_minutes) VALUES (?, ?, ?, ?, ?)',
    moduleId,
    title,
    content,
    position,
    minutes,
  ).lastInsertRowid
}

async function seed(): Promise<void> {
  initDatabase(config.databasePath)
  runMigrations()

  if (RESET) {
    console.log('[seed] --reset: clearing existing data...')
    exec(`DELETE FROM audit_logs;
          DELETE FROM notifications;
          DELETE FROM ai_messages;
          DELETE FROM ai_conversations;
          DELETE FROM progress;
          DELETE FROM evaluations;
          DELETE FROM submissions;
          DELETE FROM rubric_items;
          DELETE FROM assignments;
          DELETE FROM lessons;
          DELETE FROM modules;
          DELETE FROM enrollments;
          DELETE FROM cohorts;
          DELETE FROM programs;
          DELETE FROM users;
          DELETE FROM roles;`)
  } else if (get<{ id: number }>('SELECT id FROM users LIMIT 1')) {
    console.log('[seed] Database already contains users — nothing to do.')
    console.log('[seed] Run `npm run db:seed -- --reset` to wipe and re-seed.')
    closeDatabase()
    return
  }

  const adminHash = await hashPassword('Admin@123')
  const trainerHash = await hashPassword('Trainer@123')
  const studentHash = await hashPassword('Student@123')

  tx(() => {
    run("INSERT INTO roles (name, description) VALUES ('admin', 'Full access: users, programs, cohorts, enrollments')")
    run("INSERT INTO roles (name, description) VALUES ('trainer', 'Manages assigned programs, content, assignments and grades')")
    run("INSERT INTO roles (name, description) VALUES ('student', 'Learns enrolled programs and submits assignments')")
    const adminRole = get<{ id: number }>("SELECT id FROM roles WHERE name = 'admin'")!.id
    const trainerRole = get<{ id: number }>("SELECT id FROM roles WHERE name = 'trainer'")!.id
    const studentRole = get<{ id: number }>("SELECT id FROM roles WHERE name = 'student'")!.id

    const adminId = insertUser('Anita Rao', 'admin@tksr.demo', adminHash, adminRole)
    const rahulId = insertUser('Rahul Mehta', 'rahul@tksr.demo', trainerHash, trainerRole)
    const priyaId = insertUser('Priya Sharma', 'priya@tksr.demo', trainerHash, trainerRole)

    const students = [
      { id: insertUser('Aarav Patel', 'aarav@tksr.demo', studentHash, studentRole), name: 'Aarav Patel' },
      { id: insertUser('Diya Singh', 'diya@tksr.demo', studentHash, studentRole), name: 'Diya Singh' },
      { id: insertUser('Rohan Kumar', 'rohan@tksr.demo', studentHash, studentRole), name: 'Rohan Kumar' },
      { id: insertUser('Sneha Iyer', 'sneha@tksr.demo', studentHash, studentRole), name: 'Sneha Iyer' },
      { id: insertUser('Vikram Rao', 'vikram@tksr.demo', studentHash, studentRole), name: 'Vikram Rao' },
    ]
    const [aarav, diya, rohan, sneha, vikram] = students

    // -----------------------------------------------------------------
    // Program
    // -----------------------------------------------------------------
    const programId = run(
      `INSERT INTO programs (title, description, level, status, trainer_id, created_by)
       VALUES (?, ?, 'intermediate', 'published', ?, ?)`,
      'Applied AI Engineering',
      'A hands-on program that takes you from ML fundamentals to shipping AI systems: Python for data work, model training and evaluation, neural networks, and responsible deployment. Each module combines lessons with a graded assignment.',
      rahulId,
      adminId,
    ).lastInsertRowid

    const cohort1 = run(
      'INSERT INTO cohorts (program_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
      programId,
      'AIE - Batch 01',
      iso(-30 * DAY).slice(0, 10),
      iso(60 * DAY).slice(0, 10),
    ).lastInsertRowid
    const cohort2 = run(
      'INSERT INTO cohorts (program_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
      programId,
      'AIE - Weekend Batch',
      iso(-10 * DAY).slice(0, 10),
      iso(80 * DAY).slice(0, 10),
    ).lastInsertRowid

    for (const student of [aarav, diya, rohan]) {
      run('INSERT INTO enrollments (cohort_id, student_id, enrolled_by) VALUES (?, ?, ?)', cohort1, student.id, adminId)
    }
    for (const student of [sneha, vikram]) {
      run('INSERT INTO enrollments (cohort_id, student_id, enrolled_by) VALUES (?, ?, ?)', cohort2, student.id, adminId)
    }

    // -----------------------------------------------------------------
    // Modules & lessons
    // -----------------------------------------------------------------
    const m1 = run(
      'INSERT INTO modules (program_id, title, description, position) VALUES (?, ?, ?, 0)',
      programId,
      'Foundations of Machine Learning',
      'Core concepts: what ML is, how learning problems are framed, and how data is split.',
    ).lastInsertRowid
    const m2 = run(
      'INSERT INTO modules (program_id, title, description, position) VALUES (?, ?, ?, 1)',
      programId,
      'Python for AI',
      'Practical data work with NumPy and pandas, including cleaning messy real-world datasets.',
    ).lastInsertRowid
    const m3 = run(
      'INSERT INTO modules (program_id, title, description, position) VALUES (?, ?, ?, 2)',
      programId,
      'Neural Networks and Deep Learning',
      'How neural networks actually learn: perceptrons, backpropagation, training and regularisation.',
    ).lastInsertRowid
    const m4 = run(
      'INSERT INTO modules (program_id, title, description, position) VALUES (?, ?, ?, 3)',
      programId,
      'Deploying AI Systems',
      'Serving models, monitoring drift, and building explainable, responsible AI systems.',
    ).lastInsertRowid

    insertLesson(m1, 'What Is Machine Learning?',
      `Machine learning is programming that improves with experience: instead of hand-writing rules, you feed a system data and let it discover patterns that make predictions.

Key ideas in this lesson:
- **Specified vs learned behaviour** — a spreadsheet has fixed rules; an ML model infers rules from examples.
- **The three questions** — is this problem learnable, what data do we need, and how will we know it works?
- **Failure modes** — noisy labels, biased samples and leakage produce models that look good in demos and fail in production.

Before moving on, write down one task you do every week that is rule-based today and could become learned from data — you will use it in the first assignment.`, 0, 15)
    insertLesson(m1, 'Supervised vs Unsupervised Learning',
      `The label decides the family of the problem.

- **Supervised learning** — every example has the right answer (spam/not spam, price). You optimise a loss between prediction and truth.
- **Unsupervised learning** — no labels; the model finds structure (customer segments, anomaly clusters).
- **Semi-supervised and self-supervised** — modern hybrids where a small labelled set or the data itself provides the signal.

Practical rule: start with the supervised framing whenever you can define the answer — it is the easiest to evaluate honestly. Reserve clustering for exploration, when you genuinely do not know what to predict yet.`, 1, 15)
    insertLesson(m1, 'Training, Validation and Test Sets',
      `Splitting data correctly is the cheapest quality control you have.

- **Training set (~70%)** — the model learns from this.
- **Validation set (~15%)** — you tune hyperparameters and choose between designs using it.
- **Test set (~15%)** — touched exactly once, at the end, for an unbiased report.

Two classic mistakes: tuning against the test set (it becomes a second validation set), and splitting after preprocessing that learned from data (leakage). For time series, split by time instead of at random — yesterday's data must never leak into tomorrow's forecast.`, 2, 20)

    insertLesson(m2, 'NumPy and Vectorised Computing',
      `NumPy gives you an n-dimensional array and operations that run in compiled code instead of Python loops.

- Create arrays with \`np.array\`, \`np.arange\`, \`np.random.randn\`.
- Broadcast operations across shapes — think in vectors, not for-loops.
- Measure both correctness and speed: a vectorised mean beats a loop by orders of magnitude.

The mental shift is from *iterating over data* to *transforming tensors*. Every deep-learning framework that follows is a thin, differentiated wrapper around exactly this idea.`, 0, 20)
    insertLesson(m2, 'Data Wrangling with pandas',
      `pandas' DataFrame is a labelled table that fits in memory.

Essential moves:
- Inspect: \`.head()\`, \`.info()\`, \`.describe()\`, \`.isna().sum()\`.
- Select and filter: \`df[df.age > 30]\`, \`.loc\` vs \`.iloc\`.
- Group and aggregate: \`.groupby('segment').agg({'revenue': 'sum'})\`.
- Reshape: \`.pivot_table\`, \`.melt\`, \`.merge\`.

Write the query you would run to find the top 5 customers by revenue last quarter — then implement it. Fluency here is 80% of real AI project work.`, 1, 25)
    insertLesson(m2, 'Cleaning Real-World Datasets',
      `Real datasets lie: duplicates, mixed types, impossible values and silent categories.

A reliable cleaning pass:
1. Duplicates and primary keys.
2. Schema: force dtypes, parse dates, normalise category spellings.
3. Missing values: understand *why* they are missing before choosing a strategy.
4. Outliers: verify against domain rules before removing anything.
5. Leakage audit: does any column secretly encode the answer?

Document every decision — an unexplained drop of 200 rows will be re-litigated in every review meeting for the rest of the project.`, 2, 20)

    insertLesson(m3, 'The Perceptron and Activation Functions',
      `A neuron computes \`w·x + b\` and passes the result through an activation.

Why activations matter: without them, stacking layers collapses into a single linear transform. ReLU dominates because it trains quickly and rarely saturates; sigmoid and softmax still earn their place at output layers for probabilities.

Start small: a single neuron trained with gradient descent is already logistic regression. Everything deeper is an argument about *representation*, not about changing the fundamental learning rule.`, 0, 20)
    insertLesson(m3, 'Backpropagation Step by Step',
      `Backpropagation is just the chain rule applied systematically.

1. Forward pass — cache each layer's input and output.
2. Loss — one number describing how wrong you were.
3. Backward pass — distribute that error to each weight by how much it contributed.
4. Update — \`w -= learningRate * gradient\`.

That is the whole algorithm. Frameworks automate steps 1–3, which is why debugging a training loop means checking shapes, gradients and learning rates — not re-deriving calculus.`, 1, 25)
    insertLesson(m3, 'Training Your First Network',
      `Turning the algorithm into a working training loop:

- Choose a loss aligned with the task (cross-entropy for classes, MSE for numbers).
- Watch the learning rate: too high oscillates, too low crawls.
- Batch size trades gradient noise (helpful) against speed.
- Early stopping: keep the weights from the epoch with the best validation score.

Success criterion: the *validation* curve falls and stays close to the training curve. If not, you have a generalisation problem, not a code problem.`, 2, 30)
    insertLesson(m3, 'Regularisation and Dropout',
      `Regularisation is how you stop a large network from memorising.

- **L2 / weight decay** — penalise large weights; smooths the decision boundary.
- **Dropout** — randomly mute units during training so the network cannot rely on any single path.
- **Early stopping** — the cheapest regulariser of all.
- **Data augmentation** — the strongest one when you can generate realistic variants.

Diagnose first: overfitting means a big train/validation gap; underfitting means both are poor. Apply the medicine that matches the diagnosis.`, 3, 20)

    insertLesson(m4, 'From Model to Endpoint',
      `A trained notebook is not a product. Serving a model means:

- Freezing preprocessing and weights as one versioned artefact.
- Exposing a small API with input validation, timeouts and clear errors.
- Recording inputs and outputs so failures are debuggable.
- Keeping the previous version ready for instant rollback.

Start with the boring path — one container, one endpoint, one database table of predictions. Scale comes after you can explain every request that failed yesterday.`, 0, 20)
    insertLesson(m4, 'Monitoring Model Drift',
      `Models decay because the world moves. Monitoring catches it:

- **Data drift** — inputs changed shape or distribution (new device mix, new price range).
- **Concept drift** — the input-to-output relationship itself changed.
- **Business metrics** — the real scorecard: refunds, churn, tickets, revenue.

Set alert thresholds when you ship, not after the first incident. And keep a labelled sample flowing so you can retrain against reality rather than against a leaderboard.`, 1, 15)
    insertLesson(m4, 'Responsible AI and Explainability',
      `Shipping a model means owning its consequences.

- Document the training data, intended use and known limitations.
- Check performance slices across protected groups, not just overall accuracy.
- Use explanation tools (feature importance, SHAP-style attributions) to answer "why this decision?".
- Give affected users a human route to challenge an automated outcome.

Explainability is not a dashboard you bolt on — it is evidence that you understood what the model is allowed to decide.`, 2, 20)

    // -----------------------------------------------------------------
    // Assignments + rubrics
    // -----------------------------------------------------------------
    const a1 = run(
      `INSERT INTO assignments (program_id, module_id, title, description, max_marks, due_at, status, created_by)
       VALUES (?, ?, ?, ?, 20, ?, 'published', ?)`,
      programId,
      m1,
      'ML Problem Framing Reflection',
      `Pick a problem from your own work or daily life that could be learned from data. Write a one-page reflection (400-700 words) that frames it as an ML problem.

Cover: the business objective, the precise prediction target, candidate data sources and features, the evaluation metric you would choose and why, and one risk that could make the model fail in production.

Submit as text below, a link to a document, or a file upload.`,
      iso(7 * DAY),
      rahulId,
    ).lastInsertRowid
    const a2 = run(
      `INSERT INTO assignments (program_id, module_id, title, description, max_marks, due_at, status, created_by)
       VALUES (?, ?, ?, ?, 50, ?, 'published', ?)`,
      programId,
      m2,
      'Data Preprocessing Pipeline Write-Up',
      `Using the sample dataset provided in Module 2, document the preprocessing pipeline you built: how you handled missing values, the features you engineered, how you avoided leakage, and how you validated the result.

Structure the write-up with headings and include short code snippets. Attach your notebook as a file or link to it.`,
      iso(14 * DAY),
      rahulId,
    ).lastInsertRowid
    const a3 = run(
      `INSERT INTO assignments (program_id, module_id, title, description, max_marks, due_at, status, created_by)
       VALUES (?, ?, ?, ?, 30, ?, 'published', ?)`,
      programId,
      m3,
      'Model Evaluation Case Study',
      `Given the two confusion-matrix reports attached in Module 3, write a case study (400-700 words) that: selects the better model for a stated business context, justifies the metric, analyses the error patterns, and gives concrete next steps to improve the weaker model.`,
      iso(21 * DAY),
      rahulId,
    ).lastInsertRowid

    const rubric1: [string, string, number][] = [
      ['Problem clarity', 'Defines the objective and the prediction target precisely', 8],
      ['Data and features', 'Names realistic data sources and candidate features', 6],
      ['Evaluation & risk', 'Justifies the metric and flags a real production risk', 6],
    ]
    rubric1.forEach(([criteria, description, marks], index) => {
      run(
        'INSERT INTO rubric_items (assignment_id, criteria, description, max_marks, position) VALUES (?, ?, ?, ?, ?)',
        a1, criteria, description, marks, index,
      )
    })
    const rubric2: [string, string, number][] = [
      ['Missing values', 'Handles gaps deliberately, not blindly', 12],
      ['Feature engineering', 'Creates useful, defensible features', 14],
      ['Reproducibility', 'Steps are documented and re-runnable', 12],
      ['Validation strategy', 'Splitting and leakage controls are correct', 12],
    ]
    rubric2.forEach(([criteria, description, marks], index) => {
      run(
        'INSERT INTO rubric_items (assignment_id, criteria, description, max_marks, position) VALUES (?, ?, ?, ?, ?)',
        a2, criteria, description, marks, index,
      )
    })
    const rubric3: [string, string, number][] = [
      ['Metric selection', 'Chooses the metric that matches the business cost', 10],
      ['Error analysis', 'Reads the confusion matrices beyond accuracy', 12],
      ['Recommendations', 'Concrete, prioritised improvement steps', 8],
    ]
    rubric3.forEach(([criteria, description, marks], index) => {
      run(
        'INSERT INTO rubric_items (assignment_id, criteria, description, max_marks, position) VALUES (?, ?, ?, ?, ?)',
        a3, criteria, description, marks, index,
      )
    })

    // -----------------------------------------------------------------
    // Lesson progress
    // -----------------------------------------------------------------
    const lessons = all<{ id: number; module_id: number }>('SELECT id, module_id FROM lessons')
    const markComplete = (studentId: number, moduleId: number, count: number): void => {
      lessons
        .filter((lesson) => lesson.module_id === moduleId)
        .sort((a, b) => a.id - b.id)
        .slice(0, count)
        .forEach((lesson) => {
          run('INSERT OR IGNORE INTO progress (student_id, lesson_id) VALUES (?, ?)', studentId, lesson.id)
        })
    }
    markComplete(aarav.id, m1, 3)
    markComplete(aarav.id, m2, 1)
    markComplete(diya.id, m1, 2)
    markComplete(sneha.id, m1, 1)

    // -----------------------------------------------------------------
    // Submissions, AI evaluations and grades
    // -----------------------------------------------------------------
    const sub1 = run(
      `INSERT INTO submissions (assignment_id, student_id, content, status, is_late, attempts, submitted_at, updated_at)
       VALUES (?, ?, ?, 'graded', 0, 1, ?, ?)`,
      a1, aarav.id,
      `I framed the problem as predicting which support tickets will escalate within 48 hours.

Objective: reduce average escalation handling time for the support team. Prediction target: binary label "escalated within 48h", derived from the existing escalation log.

Data sources: historical tickets (category, channel, free-text description, customer tier) plus response-time features from the last two exchanges. I would start with ticket text TF-IDF features and categorical one-hot encodings.

Metric: I would optimise recall first, because a missed escalation costs far more engineer time than a false alarm, then check precision to keep alert volume manageable. F1 is the fallback if the classes balance differently than expected.

Risk: customer tier distribution shifted after the pricing change last quarter, so a model trained on last year's data may systematically under-rank the new lower-tier plan. I would monitor input drift by tier after deployment.`,
      iso(-2 * DAY), iso(-2 * DAY),
    ).lastInsertRowid
    run(
      `INSERT INTO evaluations (submission_id, source, suggested_score, strengths, weaknesses, suggestion_feedback, status, provider, created_by, reviewed_by, reviewed_at)
       VALUES (?, 'ai', 17, ?, ?, ?, 'accepted', 'mock', ?, ?, ?)`,
      sub1,
      ['Clear prediction target derived from an existing log', 'Metric choice is justified with a cost argument', 'Names a concrete, plausible production risk']
        .join('\n'),
      ['Feature section could mention how you would encode the free text', 'No mention of how you would split the data over time']
        .join('\n'),
      'Strong, well-structured framing with a defensible metric choice. Tighten the feature description and add a temporal validation plan to make it production-ready.',
      rahulId, rahulId, iso(-2 * DAY),
    )
    run(
      `UPDATE submissions SET score = 17, feedback = ?, graded_by = ?, graded_at = ?, updated_at = ? WHERE id = ?`,
      'Excellent framing. The recall-first argument is exactly right for escalation routing. Before you build: define the time-based split explicitly and say how you will encode the ticket text — TF-IDF vs embeddings changes the feature story. 17/20.',
      rahulId, iso(-1 * DAY), iso(-1 * DAY), sub1,
    )

    const sub2 = run(
      `INSERT INTO submissions (assignment_id, student_id, content, status, is_late, attempts, submitted_at, updated_at)
       VALUES (?, ?, ?, 'submitted', 0, 1, ?, ?)`,
      a1, diya.id,
      `My problem: predicting plant health issues from weekly sensor readings in a small office garden.

Target: binary "needs intervention this week" based on the caretaker's log.

Data: moisture, light and temperature readings from a cheap sensor kit plus the caretaker's notes. Features would be weekly min/max/mean and the rate of change of moisture.

Metric: accuracy because the classes are roughly balanced, though I could see using precision if false alarms annoy the caretaker more than missed issues.

Risk: sensors drift over time, so readings from month six are not comparable with month one without calibration.`,
      iso(-1 * DAY), iso(-1 * DAY),
    ).lastInsertRowid

    const sub3 = run(
      `INSERT INTO submissions (assignment_id, student_id, content, status, is_late, attempts, submitted_at, updated_at)
       VALUES (?, ?, ?, 'submitted', 1, 1, ?, ?)`,
      a1, rohan.id,
      `Problem: predicting whether a library book will be returned late.

Target: binary late/ontime from loan records. Features: borrower history, book category, loan duration.

Metric: precision, because the library wants to avoid annoying regular borrowers with unfair reminders.

Risk: small sample for new borrowers.`,
      iso(-0.5 * DAY), iso(-0.5 * DAY),
    ).lastInsertRowid

    const sub4 = run(
      `INSERT INTO submissions (assignment_id, student_id, content, status, is_late, attempts, submitted_at, updated_at)
       VALUES (?, ?, ?, 'graded', 0, 1, ?, ?)`,
      a2, sneha.id,
      `# Preprocessing pipeline write-up

## Missing values
Sensor gaps were 4.2% of rows. I checked whether gaps correlate with the target before choosing: they cluster on weekends, so I forward-filled within a device series and added an \`is_gap\` flag rather than dropping rows.

## Feature engineering
- 7-day rolling mean and slope per sensor
- Day-of-week and is-weekend flags
- Device age in days (calibration drift proxy)

## Reproducibility
Everything runs from one script with fixed seeds; the pipeline is fitted only on training folds and reused unchanged for validation.

## Validation strategy
Time-based 70/15/15 split, stratified by device for the final test. Scalers and encoders are fitted inside the training fold to prevent leakage.`,
      iso(-3 * DAY), iso(-3 * DAY),
    ).lastInsertRowid
    run(
      `INSERT INTO evaluations (submission_id, source, suggested_score, strengths, weaknesses, suggestion_feedback, status, provider, created_by, reviewed_by, reviewed_at)
       VALUES (?, 'ai', 47, ?, ?, ?, 'edited', 'mock', ?, ?, ?)`,
      sub4,
      ['Gap-handling decision is justified with evidence', 'Explicit leakage controls inside CV folds', 'Time-based split is the right choice for sensor data']
        .join('\n'),
      ['Rolling features could mention window selection rationale', 'No discussion of how the is_gap flag performed']
        .join('\n'),
      'Well-organised and reproducible. Strengthen the window-selection justification and report the is_gap feature importance.',
      rahulId, rahulId, iso(-2 * DAY),
    )
    run(
      `UPDATE submissions SET score = 44, feedback = ?, graded_by = ?, graded_at = ?, updated_at = ? WHERE id = ?`,
      'Very solid work — the leakage audit and time-based split show real engineering judgement. Minor deductions: justify the rolling-window lengths and report whether is_gap actually helped. 44/50.',
      rahulId, iso(-2 * DAY), iso(-2 * DAY), sub4,
    )

    // -----------------------------------------------------------------
    // AI tutor conversation (student: Aarav)
    // -----------------------------------------------------------------
    const conversation = run(
      'INSERT INTO ai_conversations (user_id, title, program_id) VALUES (?, ?, ?)',
      aarav.id, 'Precision vs recall for escalations', programId,
    ).lastInsertRowid
    run(
      'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      conversation, 'user', 'When should I prefer precision over recall for my escalation model?', iso(-1 * DAY),
    )
    run(
      `INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
      conversation, 'assistant',
      `Good question — this comes up a lot in *Applied AI Engineering*.

**Precision vs recall** answer different questions:

- *Precision* — of everything the model flagged positive, how much was right? Minimises false alarms.
- *Recall* — of everything that truly was positive, how much did it find? Minimises misses.
- *F1* is the harmonic mean of both, useful when classes are imbalanced.

**Hint:** pick your metric from the cost of errors. Missed escalations are expensive → favour recall. Alert fatigue from false alarms is the bigger problem → favour precision.

**Try this:** for 80 true positives, 20 false positives and 30 false negatives, compute both — which error type dominates?`,
      iso(-1 * DAY),
    )
    run(
      'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      conversation, 'user', 'Can you write the reflection for my assignment?', iso(-1 * DAY),
    )
    run(
      'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      conversation, 'assistant',
      `I can't complete a graded assignment for you — that would work against your own learning (and your trainer would notice!).

But I can help you get unstuck:

- **Outline first:** list the 3-5 points your answer must cover, in order.
- **Start small:** answer just the first sub-question, and I'll give you feedback on your reasoning.
- **Practice example:** I can walk through a *similar* problem you can learn from.

Tell me which part you've attempted so far, and we'll work through it together.`,
      iso(-1 * DAY),
    )

    // -----------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------
    const notifications: [number, string, string, string, string | null, string | null][] = [
      [aarav.id, 'Your assignment has been graded', 'ML Problem Framing Reflection: 17/20 — feedback available.', 'grade', `/app/assignments/${a1}`, iso(-1 * DAY)],
      [sneha.id, 'Your assignment has been graded', 'Data Preprocessing Pipeline Write-Up: 44/50 — feedback available.', 'grade', `/app/assignments/${a2}`, iso(-2 * DAY)],
      [diya.id, 'New assignment published', 'ML Problem Framing Reflection is now available (20 marks).', 'assignment', `/app/assignments/${a1}`, iso(-6 * DAY)],
      [rohan.id, 'New assignment published', 'ML Problem Framing Reflection is now available (20 marks).', 'assignment', `/app/assignments/${a1}`, iso(-6 * DAY)],
      [vikram.id, 'New assignment published', 'ML Problem Framing Reflection is now available (20 marks).', 'assignment', `/app/assignments/${a1}`, iso(-6 * DAY)],
      [aarav.id, 'New assignment published', 'Data Preprocessing Pipeline Write-Up is now available (50 marks).', 'assignment', `/app/assignments/${a2}`, iso(-5 * DAY)],
      [rahulId, 'New submission to review', 'Diya Singh submitted "ML Problem Framing Reflection".', 'info', `/app/submissions/${sub2}`, iso(-1 * DAY)],
    ]
    notifications.forEach(([userId, title, body, type, link, createdAt]) => {
      run(
        'INSERT INTO notifications (user_id, title, body, type, link, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        userId, title, body, type, link, createdAt,
      )
    })
    // The grade notification was already seen; everything else stays unread for the badge demo.
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND type = ?', iso(-0.5 * DAY), aarav.id, 'grade')

    // -----------------------------------------------------------------
    // Audit history
    // -----------------------------------------------------------------
    const auditEntries: [number | null, string, string, string, Record<string, unknown>, string][] = [
      [adminId, 'user.create', 'user', String(rahulId), { name: 'Rahul Mehta', role: 'trainer' }, iso(-40 * DAY)],
      [adminId, 'user.create', 'user', String(priyaId), { name: 'Priya Sharma', role: 'trainer' }, iso(-40 * DAY)],
      [adminId, 'program.create', 'program', String(programId), { title: 'Applied AI Engineering' }, iso(-35 * DAY)],
      [adminId, 'program.assign_trainer', 'program', String(programId), { trainerId: rahulId }, iso(-35 * DAY)],
      [adminId, 'cohort.create', 'cohort', String(cohort1), { name: 'AIE - Batch 01' }, iso(-30 * DAY)],
      [adminId, 'cohort.create', 'cohort', String(cohort2), { name: 'AIE - Weekend Batch' }, iso(-10 * DAY)],
      [adminId, 'enrollment.create', 'cohort', String(cohort1), { count: 3 }, iso(-30 * DAY)],
      [adminId, 'enrollment.create', 'cohort', String(cohort2), { count: 2 }, iso(-10 * DAY)],
      [rahulId, 'assignment.publish', 'assignment', String(a1), { title: 'ML Problem Framing Reflection' }, iso(-6 * DAY)],
      [rahulId, 'assignment.publish', 'assignment', String(a2), { title: 'Data Preprocessing Pipeline Write-Up' }, iso(-5 * DAY)],
      [rahulId, 'assignment.publish', 'assignment', String(a3), { title: 'Model Evaluation Case Study' }, iso(-4 * DAY)],
      [aarav.id, 'submission.create', 'submission', String(sub1), { assignmentId: a1 }, iso(-2 * DAY)],
      [rahulId, 'ai.evaluate', 'submission', String(sub1), { provider: 'mock', suggestedScore: 17 }, iso(-2 * DAY)],
      [rahulId, 'grade.release', 'submission', String(sub1), { score: 17, evaluationStatus: 'accepted' }, iso(-1 * DAY)],
      [diya.id, 'submission.create', 'submission', String(sub2), { assignmentId: a1 }, iso(-1 * DAY)],
      [sneha.id, 'submission.create', 'submission', String(sub4), { assignmentId: a2 }, iso(-3 * DAY)],
      [rahulId, 'grade.release', 'submission', String(sub4), { score: 44, evaluationStatus: 'edited' }, iso(-2 * DAY)],
      [rohan.id, 'submission.create', 'submission', String(sub3), { assignmentId: a1, isLate: true }, iso(-0.5 * DAY)],
      [aarav.id, 'ai.tutor_message', 'ai_conversation', String(conversation), { provider: 'mock' }, iso(-1 * DAY)],
    ]
    auditEntries.forEach(([userId, action, entityType, entityId, metadata, createdAt]) => {
      run(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        userId, action, entityType, entityId, JSON.stringify(metadata), createdAt,
      )
    })

    console.log('[seed] Demo data created.')
    console.log('[seed]   Admin    admin@tksr.demo     / Admin@123')
    console.log('[seed]   Trainer  rahul@tksr.demo     / Trainer@123   (owns the program)')
    console.log('[seed]   Trainer  priya@tksr.demo     / Trainer@123   (no program yet)')
    console.log('[seed]   Students aarav@tksr.demo ... / Student@123   (5 accounts)')
    void vikram
  })

  closeDatabase()
}

seed().catch((error) => {
  console.error('[seed] Failed:', error)
  closeDatabase()
  process.exit(1)
})
