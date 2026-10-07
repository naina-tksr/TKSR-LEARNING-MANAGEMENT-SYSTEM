import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { initSession, session } from './lms/session'
import type { Role } from './lms/types'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    public?: boolean
    roles?: Role[]
    title?: string
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./lms/views/LoginPage.vue'),
    meta: { public: true, title: 'Sign in' },
  },
  { path: '/', redirect: '/app' },
  {
    path: '/app',
    component: () => import('./lms/components/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'dashboard', component: () => import('./lms/views/DashboardPage.vue'), meta: { title: 'Dashboard' } },
      { path: 'programs', name: 'programs', component: () => import('./lms/views/ProgramsPage.vue'), meta: { title: 'Programs' } },
      {
        path: 'programs/:id',
        name: 'program-detail',
        component: () => import('./lms/views/ProgramDetailPage.vue'),
        meta: { title: 'Program' },
      },
      {
        path: 'programs/:id/modules/:moduleId/lessons/:lessonId',
        name: 'lesson',
        component: () => import('./lms/views/LessonPage.vue'),
        meta: { title: 'Lesson' },
      },
      { path: 'assignments', name: 'assignments', component: () => import('./lms/views/AssignmentsPage.vue'), meta: { title: 'Assignments' } },
      {
        path: 'assignments/:id',
        name: 'assignment-detail',
        component: () => import('./lms/views/AssignmentDetailPage.vue'),
        meta: { title: 'Assignment' },
      },
      {
        path: 'grading',
        name: 'grading',
        component: () => import('./lms/views/GradingQueuePage.vue'),
        meta: { roles: ['admin', 'trainer'], title: 'Grading queue' },
      },
      {
        path: 'grading/:id',
        name: 'grade-submission',
        component: () => import('./lms/views/SubmissionGradePage.vue'),
        meta: { roles: ['admin', 'trainer'], title: 'Grade submission' },
      },
      { path: 'users', name: 'users', component: () => import('./lms/views/UsersPage.vue'), meta: { roles: ['admin'], title: 'Users' } },
      { path: 'cohorts', name: 'cohorts', component: () => import('./lms/views/CohortsPage.vue'), meta: { roles: ['admin'], title: 'Cohorts' } },
      { path: 'audit', name: 'audit', component: () => import('./lms/views/AuditPage.vue'), meta: { roles: ['admin'], title: 'Audit log' } },
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('./lms/views/NotificationsPage.vue'),
        meta: { title: 'Notifications' },
      },
      { path: 'tutor', name: 'tutor', component: () => import('./lms/views/AiTutorPage.vue'), meta: { title: 'AI Tutor' } },
      {
        path: 'my-submissions',
        name: 'my-submissions',
        component: () => import('./lms/views/MySubmissionsPage.vue'),
        meta: { roles: ['student'], title: 'My submissions' },
      },
      { path: ':pathMatch(.*)*', redirect: '/app' },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/app' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  await initSession()

  if (to.meta.public) {
    // Signed-in users do not need the login page.
    if (session.user && to.name === 'login') return { name: 'dashboard' }
    return true
  }

  if (!session.user) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  const roles = to.meta.roles
  if (roles && roles.length > 0 && !roles.includes(session.user.role)) {
    return { name: 'dashboard' }
  }

  return true
})
