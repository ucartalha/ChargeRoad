import {Module} from '@nestjs/common';
import {DatabaseModule} from '../../database/database.module';
import {EvPlanningModule} from '../ev-planning.module';
import {PlanningController} from './planning.controller';
import {PlanningHttpService} from './planning-http.service';
import {PlanningExecution} from './planning-execution';
import {PlanningAdmissionStore} from './planning-admission.store';
import {PgPlanningAdmission} from './pg-planning-admission';
import {PLANNING_HTTP_OPTIONS,planningHttpOptions} from './planning-http-policy';
import {PlanningJobsController} from './planning-jobs.controller';
import {PlanningJobsStore} from './planning-jobs.store';
import {PlanningJobsWorker} from './planning-jobs.worker';
@Module({imports:[DatabaseModule,EvPlanningModule],controllers:[PlanningController,PlanningJobsController],providers:[PlanningHttpService,PlanningExecution,PlanningJobsStore,PlanningJobsWorker,
  {provide:PlanningAdmissionStore,useClass:PgPlanningAdmission},{provide:PLANNING_HTTP_OPTIONS,useFactory:planningHttpOptions}],exports:[PlanningHttpService,PlanningAdmissionStore,PlanningJobsWorker]})
export class PlanningHttpModule {}
