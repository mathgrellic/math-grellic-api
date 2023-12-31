import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsRelations,
  FindOptionsWhere,
  ILike,
  Not,
  Repository,
} from 'typeorm';
import dayjs from '#/common/configs/dayjs.config';

import { DEFAULT_TAKE } from '#/common/helpers/pagination.helper';
import { generateFullName } from '#/common/helpers/string.helper';
import { StudentUserAccount } from '../user/entities/student-user-account.entity';
import { UserApprovalStatus } from '../user/enums/user.enum';
import { Exam } from '../exam/entities/exam.entity';
import { Activity } from '../activity/entities/activity.entity';
import { ActivityCategoryType } from '../activity/enums/activity.enum';
import { ExamService } from '../exam/exam.service';
import { ActivityService } from '../activity/activity.service';
import { StudentPerformance } from './models/performance.model';
import { StudentPerformanceType } from './enums/performance.enum';

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(StudentUserAccount)
    private readonly studentUserAccountRepo: Repository<StudentUserAccount>,
    @Inject(ExamService)
    private readonly examService: ExamService,
    @Inject(ActivityService)
    private readonly activityService: ActivityService,
  ) {}

  async generateOverallExamRankings(students: StudentUserAccount[]) {
    let previousScore = null;
    let currentRank = null;

    const transformedStudents = students.map((student) => {
      // Remove duplicate exam completion
      const filteredExamCompletions = student.examCompletions
        .sort(
          (catA, catB) =>
            catB.submittedAt.valueOf() - catA.submittedAt.valueOf(),
        )
        .filter(
          (cat, index, array) =>
            array.findIndex((item) => item.exam.id === cat.exam.id) === index,
        );

      if (!filteredExamCompletions.length) {
        return { ...student, overallExamScore: null };
      }

      // Calculate total exam scores (overall)
      const overallExamScore = filteredExamCompletions.reduce(
        (total, currentValue) => currentValue.score + total,
        0,
      );

      return { ...student, overallExamScore };
    });

    const rankedStudents = transformedStudents
      .filter((s) => s.overallExamScore != null)
      .sort((a, b) => b.overallExamScore - a.overallExamScore)
      .map((student, index) => {
        if (student.overallExamScore !== previousScore) {
          currentRank = index + 1;
        }

        previousScore = student.overallExamScore;

        return { ...student, overallExamRank: currentRank };
      });

    const unrankedStudents = transformedStudents
      .filter((s) => s.overallExamScore == null)
      .sort((a, b) => {
        const aFullname = generateFullName(
          a.firstName,
          a.lastName,
          a.middleName,
        );
        const bFullname = generateFullName(
          b.firstName,
          b.lastName,
          b.middleName,
        );

        return aFullname.localeCompare(bFullname);
      })
      .map((s) => ({ ...s, overallExamRank: null }));

    return {
      rankedStudents,
      unrankedStudents,
    };
  }

  async generateOverallActivityRankings(students: StudentUserAccount[]) {
    let previousScore = null;
    let currentRank = null;

    const transformedStudents = students.map((student) => {
      // Remove duplicate activity completion
      const filteredActivityCompletions = student.activityCompletions
        .sort(
          (catA, catB) =>
            catB.submittedAt.valueOf() - catA.submittedAt.valueOf(),
        )
        .filter(
          (cat, index, array) =>
            array.findIndex(
              (item) => item.activityCategory.id === cat.activityCategory.id,
            ) === index,
        );

      if (!filteredActivityCompletions.length) {
        return {
          ...student,
          overallActivityScore: null,
        };
      }

      // Filter non time-based activities
      const poinLevelActivityCompletions = filteredActivityCompletions.filter(
        (com) =>
          com.activityCategory.activity.game.type !== ActivityCategoryType.Time,
      );

      // Calculate total point/level score
      const totalPointLevelScore = poinLevelActivityCompletions.reduce(
        (total, com) => (com.score || 0) + total,
        0,
      );

      // Filter time-based activities
      const timeActivityCompletions = filteredActivityCompletions.filter(
        (com) =>
          com.activityCategory.activity.game.type === ActivityCategoryType.Time,
      );

      const timeActivityIds = timeActivityCompletions
        .map((com) => com.activityCategory.activity.id)
        .filter((id, index, array) => array.indexOf(id) === index);

      const totalTimeScore = timeActivityIds
        .map((activityId) => {
          const targetCompletions = timeActivityCompletions.filter(
            (com) => com.activityCategory.activity.id === activityId,
          );

          // Remove duplicate
          const filteredTargetCompletions = targetCompletions.filter(
            (com, index, array) =>
              array.findIndex(
                (item) =>
                  item.activityCategory.level === com.activityCategory.level,
              ) === index,
          );

          if (filteredTargetCompletions.length === 3) {
            const time = filteredTargetCompletions.reduce(
              (total, com) => (com.score || 0) + total,
              0,
            );
            return time / 3;
          }

          return null;
        })
        .filter((avgTime) => !!avgTime)
        .reduce((total, avgTime) => total + 1 / avgTime, 0);

      const overallActivityScore = totalPointLevelScore + totalTimeScore;

      return { ...student, overallActivityScore, overallActivityRank: null };
    });

    const rankedStudents = transformedStudents
      .filter((s) => s.overallActivityScore != null)
      .sort((a, b) => b.overallActivityScore - a.overallActivityScore)
      .map((student, index) => {
        if (student.overallActivityScore !== previousScore) {
          currentRank = index + 1;
        }

        previousScore = student.overallActivityScore;

        return { ...student, overallActivityRank: currentRank };
      });

    const unrankedStudents = transformedStudents
      .filter((s) => s.overallActivityScore == null)
      .sort((a, b) => {
        const aFullname = generateFullName(
          a.firstName,
          a.lastName,
          a.middleName,
        );
        const bFullname = generateFullName(
          b.firstName,
          b.lastName,
          b.middleName,
        );

        return aFullname.localeCompare(bFullname);
      })
      .map((s) => ({ ...s, overallActivityRank: null }));

    return { rankedStudents, unrankedStudents };
  }

  async generateOverallExamDetailedPerformance(
    student: StudentUserAccount,
    otherStudents: StudentUserAccount[],
  ) {
    const allExams = await this.examService.getAllByStudentId(student.id);

    const availableExams = allExams.filter((exam) => {
      const currentDateTime = dayjs().toDate();
      const isAvailable = exam.schedules.some(
        (schedule) =>
          dayjs(schedule.startDate).isBefore(currentDateTime) ||
          dayjs(schedule.startDate).isSame(currentDateTime),
      );

      return isAvailable;
    });

    const examCompletions = student.examCompletions.filter(
      (ec, index, self) =>
        index === self.findIndex((t) => t.exam.id === ec.exam.id),
    );

    const examsPassedCount = examCompletions.filter(
      (ec) => ec.score >= ec.exam.passingPoints,
    ).length;

    const examsFailedCount = examCompletions.filter(
      (ec) => ec.score < ec.exam.passingPoints,
    ).length;

    const examsExpiredCount = availableExams.filter(
      (exam) => !examCompletions.find((ec) => ec.exam.id === exam.id),
    ).length;

    const overallExamCompletionPercent = (() => {
      const value = (availableExams.length / allExams.length) * 100;
      return +value.toFixed(2);
    })();

    const { rankedStudents, unrankedStudents } =
      await this.generateOverallExamRankings([student, ...otherStudents]);

    const { overallExamRank, overallExamScore } = [
      ...rankedStudents,
      ...unrankedStudents,
    ].find((s) => s.id === student.id);

    return {
      currentExamCount: availableExams.length,
      examsCompletedCount: examCompletions.length,
      examsPassedCount,
      examsFailedCount,
      examsExpiredCount,
      overallExamCompletionPercent,
      overallExamRank,
      overallExamScore,
    };
  }

  async generateOverallActivityDetailedPerformance(
    student: StudentUserAccount,
    otherStudents: StudentUserAccount[],
  ) {
    const allActivities = await this.activityService.getAllByStudentId(
      student.id,
    );

    const sortedCompletions = student.activityCompletions.sort(
      (comA, comB) => comB.submittedAt.valueOf() - comA.submittedAt.valueOf(),
    );

    const { rankedStudents, unrankedStudents } =
      await this.generateOverallActivityRankings([student, ...otherStudents]);

    const { overallActivityScore, overallActivityRank } = [
      ...rankedStudents,
      ...unrankedStudents,
    ].find((s) => s.id === student.id);

    // Calculate completed activity in percent
    const overallActivityCompletionPercent = (() => {
      const categoryCount = allActivities.reduce(
        (total, activity) => total + activity.categories.length,
        0,
      );

      const categoryCompletionCount = sortedCompletions.filter(
        (com, index, array) =>
          array.findIndex(
            (item) => item.activityCategory.id === com.activityCategory.id,
          ) === index,
      ).length;

      const value = (categoryCompletionCount / categoryCount) * 100;
      return +value.toFixed(2);
    })();

    let activitiesCompletedCount = 0;
    // Count activities completed,
    // for time or point game type. count as done if all three levels are completed
    allActivities.forEach((activity) => {
      const completions = sortedCompletions
        .filter((com) =>
          activity.categories.some((cat) => cat.id === com.activityCategory.id),
        )
        .filter(
          (com, index, array) =>
            array.findIndex(
              (item) =>
                item.activityCategory.level === com.activityCategory.level,
            ) === index,
        );

      if (!completions.length) {
        return;
      }

      if (activity.game.type === ActivityCategoryType.Stage) {
        activitiesCompletedCount += 1;
      } else {
        if (completions.length === 3) {
          activitiesCompletedCount += 1;
        }
      }
    });

    return {
      overallActivityRank,
      overallActivityScore,
      totalActivityCount: allActivities.length,
      activitiesCompletedCount,
      overallActivityCompletionPercent,
    };
  }

  // TEACHERS

  async getPaginationStudentPerformancesByTeacherId(
    teacherId: number,
    sort: string,
    take: number = DEFAULT_TAKE,
    skip: number = 0,
    q?: string,
    performance = StudentPerformanceType.Exam,
  ): Promise<[Partial<StudentPerformance>[], number]> {
    const generateWhere = () => {
      const baseWhere: FindOptionsWhere<StudentUserAccount> = {
        teacherUser: { id: teacherId },
        user: { approvalStatus: UserApprovalStatus.Approved },
      };

      if (!!q?.trim()) {
        return [
          { firstName: ILike(`%${q}%`), ...baseWhere },
          { lastName: ILike(`%${q}%`), ...baseWhere },
          { middleName: ILike(`%${q}%`), ...baseWhere },
        ];
      }

      return baseWhere;
    };

    // Get completion base on target performance (lesson, exam, activity)
    const generateRelations = () => {
      const baseRelations: FindOptionsRelations<StudentUserAccount> = {
        user: true,
      };

      if (performance === StudentPerformanceType.Exam) {
        return { ...baseRelations, examCompletions: { exam: true } };
      } else {
        return {
          ...baseRelations,
          activityCompletions: { activityCategory: { activity: true } },
        };
      }
    };

    const [students, studentCount] =
      await this.studentUserAccountRepo.findAndCount({
        where: generateWhere(),
        loadEagerRelations: false,
        relations: generateRelations(),
        select: {
          user: {
            publicId: true,
            email: true,
          },
        },
      });

    const { rankedStudents, unrankedStudents } = await (performance ===
    StudentPerformanceType.Exam
      ? this.generateOverallExamRankings(students)
      : this.generateOverallActivityRankings(students));

    let targetStudents = [...rankedStudents, ...unrankedStudents];

    const [sortBy, sortOrder] = sort?.split(',') || [];

    if (sortBy === 'name') {
      targetStudents = targetStudents.sort((a, b) => {
        const aFullname = generateFullName(
          a.firstName,
          a.lastName,
          a.middleName,
        );
        const bFullname = generateFullName(
          b.firstName,
          b.lastName,
          b.middleName,
        );

        if (sortOrder === 'asc') {
          return aFullname.localeCompare(bFullname);
        } else {
          return bFullname.localeCompare(aFullname);
        }
      });
    } else if (sortBy === 'rank') {
      if (sortOrder === 'desc') {
        targetStudents = [
          ...unrankedStudents,
          ...[...rankedStudents].reverse(),
        ];
      }
    }

    // Slice array for current page
    const endIndex = skip + take;
    return [targetStudents.slice(skip, endIndex), studentCount];
  }

  async getStudentPerformanceByPublicIdAndTeacherId(
    publicId: string,
    teacherId: number,
  ): Promise<StudentPerformance> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        teacherUser: { id: teacherId },
        user: {
          publicId: publicId.toUpperCase(),
          approvalStatus: UserApprovalStatus.Approved,
        },
      },
      loadEagerRelations: false,
      relations: {
        user: true,
        lessonCompletions: true,
        activityCompletions: { activityCategory: { activity: true } },
        examCompletions: { exam: true },
      },
      select: {
        user: {
          publicId: true,
          email: true,
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const otherStudents = await this.studentUserAccountRepo.find({
      where: {
        teacherUser: { id: teacherId },
        user: {
          publicId: Not(publicId.toUpperCase()),
          approvalStatus: UserApprovalStatus.Approved,
        },
      },
      loadEagerRelations: false,
      relations: {
        lessonCompletions: true,
        activityCompletions: { activityCategory: { activity: true } },
        examCompletions: { exam: true },
      },
    });

    const examPerformance = await this.generateOverallExamDetailedPerformance(
      student,
      otherStudents,
    );

    const activityPerformance =
      await this.generateOverallActivityDetailedPerformance(
        student,
        otherStudents,
      );

    const transformedStudent = {
      ...student,
      lessonCompletions: undefined,
      examCompletions: undefined,
      activityCompletions: undefined,
    };

    return {
      ...transformedStudent,
      ...examPerformance,
      ...activityPerformance,
    };
  }

  async getStudentExamsByPublicIdAndTeacherId(
    publicId: string,
    teacherId: number,
  ): Promise<Exam[]> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        teacherUser: { id: teacherId },
        user: {
          publicId: publicId.toUpperCase(),
          approvalStatus: UserApprovalStatus.Approved,
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const exams =
      await this.examService.getExamsWithCompletionsByStudentIdAndTeacherId(
        student.id,
        teacherId,
      );

    const transformedExams = Promise.all(
      exams.map(async (exam) => {
        const rankings = await this.examService.generateExamRankings(
          exam,
          teacherId,
        );

        const { rank, completions } = rankings.find(
          (rank) => rank.studentId === student.id,
        );

        return { ...exam, rank, completions };
      }),
    );

    return transformedExams;
  }

  async getStudentActivitiesByPublicIdAndTeacherId(
    publicId: string,
    teacherId: number,
  ): Promise<Activity[]> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        teacherUser: { id: teacherId },
        user: {
          publicId: publicId.toUpperCase(),
          approvalStatus: UserApprovalStatus.Approved,
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const activities =
      await this.activityService.getActivitiesWithCompletionsByStudentIdAndTeacherId(
        student.id,
        teacherId,
      );

    const transformedActivities = Promise.all(
      activities.map(async (activity) => {
        const rankings = await this.activityService.generateActivityRankings(
          activity,
          teacherId,
        );

        const { rank, completions } = rankings.find(
          (rank) => rank.studentId === student.id,
        );

        return { ...activity, rank, completions };
      }),
    );

    return transformedActivities;
  }

  async getStudentExamWithCompletionsByPublicIdAndSlug(
    publicId: string,
    slug: string,
    teacherId: number,
  ): Promise<Exam> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        teacherUser: { id: teacherId },
        user: {
          publicId: publicId.toUpperCase(),
          approvalStatus: UserApprovalStatus.Approved,
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.examService.getOneBySlugAndStudentId(
      slug,
      student.id,
      true,
    ) as Promise<Exam>;
  }

  async getStudentActivityWithCompletionsByPublicIdAndSlug(
    publicId: string,
    slug: string,
    teacherId: number,
  ): Promise<Activity> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        teacherUser: { id: teacherId },
        user: {
          publicId: publicId.toUpperCase(),
          approvalStatus: UserApprovalStatus.Approved,
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.activityService.getOneBySlugAndStudentId(
      slug,
      student.id,
    ) as Promise<Activity>;
  }

  // STUDENTS

  async getStudentPerformanceByStudentId(
    studentId: number,
  ): Promise<StudentPerformance> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        id: studentId,
        user: { approvalStatus: UserApprovalStatus.Approved },
      },
      loadEagerRelations: false,
      relations: {
        user: true,
        teacherUser: true,
        lessonCompletions: true,
        activityCompletions: { activityCategory: true },
        examCompletions: { exam: true },
      },
      select: {
        user: {
          publicId: true,
          email: true,
        },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const otherStudents = await this.studentUserAccountRepo.find({
      where: {
        id: Not(student.id),
        teacherUser: { id: student.teacherUser.id },
        user: {
          approvalStatus: UserApprovalStatus.Approved,
        },
      },
      loadEagerRelations: false,
      relations: {
        lessonCompletions: true,
        activityCompletions: { activityCategory: { activity: true } },
        examCompletions: true,
      },
    });

    const examPerformance = await this.generateOverallExamDetailedPerformance(
      student,
      otherStudents,
    );

    const activityPerformance =
      await this.generateOverallActivityDetailedPerformance(
        student,
        otherStudents,
      );

    const transformedStudent = {
      ...student,
      lessonCompletions: undefined,
      examCompletions: undefined,
      activityCompletions: undefined,
    };

    return {
      ...transformedStudent,
      ...examPerformance,
      ...activityPerformance,
    };
  }

  async getStudentExamsByStudentId(studentId: number): Promise<Exam[]> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        id: studentId,
        user: { approvalStatus: UserApprovalStatus.Approved },
      },
      relations: { teacherUser: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const exams =
      await this.examService.getExamsWithCompletionsByStudentIdAndTeacherId(
        student.id,
        student.teacherUser.id,
      );

    const transformedExams = Promise.all(
      exams.map(async (exam) => {
        const rankings = await this.examService.generateExamRankings(
          exam,
          student.teacherUser.id,
        );

        const { rank, completions } = rankings.find(
          (rank) => rank.studentId === student.id,
        );

        return { ...exam, rank, completions };
      }),
    );

    return transformedExams;
  }

  async getStudentActivitiesByStudentId(
    studentId: number,
  ): Promise<Activity[]> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        id: studentId,
        user: { approvalStatus: UserApprovalStatus.Approved },
      },
      relations: { teacherUser: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const activities =
      await this.activityService.getActivitiesWithCompletionsByStudentIdAndTeacherId(
        student.id,
        student.teacherUser.id,
      );

    const transformedActivities = Promise.all(
      activities.map(async (activity) => {
        const rankings = await this.activityService.generateActivityRankings(
          activity,
          student.teacherUser.id,
        );

        const { rank, completions } = rankings.find(
          (rank) => rank.studentId === student.id,
        );

        return { ...activity, rank, completions };
      }),
    );

    return transformedActivities;
  }

  async getStudentExamWithCompletionsBySlugAndStudentId(
    slug: string,
    studentId: number,
  ): Promise<Exam> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        id: studentId,
        user: { approvalStatus: UserApprovalStatus.Approved },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.examService.getOneBySlugAndStudentId(
      slug,
      student.id,
      true,
    ) as Promise<Exam>;
  }

  async getStudentActivityWithCompletionsBySlugAndStudentId(
    slug: string,
    studentId: number,
  ): Promise<Activity> {
    const student = await this.studentUserAccountRepo.findOne({
      where: {
        id: studentId,
        user: { approvalStatus: UserApprovalStatus.Approved },
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.activityService.getOneBySlugAndStudentId(
      slug,
      student.id,
    ) as Promise<Activity>;
  }
}
