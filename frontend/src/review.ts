import type { AnswerQuestion } from './answer';
export type QuestionSummary = {question_version_id:string;kind:AnswerQuestion['kind'];required:boolean;
  objective_ids:string[];attempt_count:number;incorrect_count:number;latest_correct:boolean|null};
export type QuestionPage = {items:QuestionSummary[];next_after_id:string|null;has_more:boolean};
export type ReviewItem = {unit_id:string;course_id:string;question:AnswerQuestion;attempt_count:number;incorrect_count:number;latest_correct:boolean};
export type ReviewCourse = {course_id:string;items:ReviewItem[]};
