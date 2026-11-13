export interface PlanningLease {slot:number;token:string;}
export abstract class PlanningAdmissionStore {
  abstract acquire(ttlMilliseconds:number,signal:AbortSignal):Promise<PlanningLease|null>;
  abstract renew(lease:PlanningLease,ttlMilliseconds:number):Promise<boolean>;
  abstract release(lease:PlanningLease):Promise<void>;
}
