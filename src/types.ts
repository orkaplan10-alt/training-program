export type UserRole = 'coach' | 'client';

export interface Exercise {
  id?: string;
  name: string;
  sets: number;
  reps: number;
  weight: string;
  rest: string;
  tempo?: string;
  rpe?: number;
  notes?: string;
  instructions?: string;
  videoUrl?: string;
  type?: 'warm-up' | 'main' | 'cool-down';
}

export interface Workout {
  id: string;
  coachId: string;
  clientId: string;
  title: string;
  exercises: Exercise[];
  category?: string;
  goal?: string;
  intensity?: string;
  isPublic?: boolean;
  shareToken?: string;
  expiresAt?: any; // Firestore Timestamp
  createdAt: any; // Firestore Timestamp
}

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
  googleTokens?: any;
}

export interface WorkoutTemplate {
  id: string;
  coachId: string;
  title: string;
  exercises: Exercise[];
  category?: string;
  goal?: string;
  intensity?: string;
}
