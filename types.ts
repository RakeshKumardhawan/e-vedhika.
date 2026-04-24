/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Post {
  id: string;
  title: string;
  content: string;
  category: string;
  subCategory?: string;
  mediaUrl?: string;
  mediaType?: string;
  likes: number;
  views: number;
  comments: Comment[];
  likedBy?: string[];
  userName?: string;
  time: number;
  uid: string;
}

export interface Comment {
  user: string;
  msg: string;
  time: number;
}

export interface ChatMessage {
  id: string;
  msg: string;
  time: number;
  uid: string;
}

export interface UserProfile {
  id: string;
  username: string;
  village?: string;
  office?: string;
  bio?: string;
  time: number;
}

export interface Suggestion {
  id: string;
  name: string;
  text: string;
  status: 'pending' | 'approved';
  time: number;
}

export interface ProblemReport {
  id: string;
  msg: string;
  category?: string;
  status?: 'pending' | 'solved';
  time: number;
  uid: string;
}

export interface RequestData {
  id: string;
  msg: string;
  time: number;
  uid: string;
}
