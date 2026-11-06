import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import PipelineRunLog, {IPipelineRunLog} from "./pipelineRunLog";

export class PipelineRunLogService extends BaseCrudService<IPipelineRunLog, typeof PipelineRunLog> {
    constructor() {
        super(PipelineRunLog, "SwissOutreachPipelineRunLog");
    }
}

export const pipelineRunLogService = new PipelineRunLogService();
