import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';
import { LessonModule } from '../lesson/lesson.module';
import { Exam } from './entities/exam.entity';
import { ExamQuestion } from './entities/exam-question.entity';
import { ExamQuestionChoice } from './entities/exam-question-choice.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { ExamController } from './exam.controller';
import { ExamSubscriber } from './subscribers/exam.subscriber';
import { ExamService } from './exam.service';
import { ExamScheduleService } from './exam-schedule.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exam,
      ExamQuestion,
      ExamQuestionChoice,
      ExamSchedule,
    ]),
    UserModule,
    LessonModule,
  ],
  controllers: [ExamController],
  providers: [ExamSubscriber, ExamService, ExamScheduleService],
})
export class ExamModule {}

// TODO exam subscriber listener generate slug
