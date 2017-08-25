/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject } from 'inversify';
import { ILogger } from '@theia/core/lib/common/';
import { ProcessType } from '../common/task-protocol';
import { TaskManager } from './task-manager';
import { Process, ProcessManager } from "@theia/process/lib/node";

export const TaskOptions = Symbol("TaskProcessOptions");
export interface TaskOptions {
    label: string,
    command: string,
    process: Process,
    processType: ProcessType,
    context: string
}

export const TaskFactory = Symbol("TaskFactory");
export type TaskFactory = (options: TaskOptions) => Task;

@injectable()
export class Task {
    protected taskId: number;
    protected taskOptions: TaskOptions;

    constructor(
        @inject(TaskManager) protected readonly taskManager: TaskManager,
        @inject(ILogger) protected readonly logger: ILogger,
        @inject(TaskOptions) protected readonly options: TaskOptions,
        @inject(ProcessManager) protected readonly processManager: ProcessManager
    ) {
        this.taskOptions = options;
        this.taskId = this.taskManager.register(this, this.options.context);

        const toDispose =
            this.process.onExit(event => {
                this.taskManager.delete(this);
                // note: deleting the process from the process manager means that we
                // no longer have access to its terminal. So we can't e.g. show what
                // was last displayed in it.
                // give a bit of time before cleanup...
                setInterval(() => {
                    this.processManager.delete(this.taskOptions.process);
                    toDispose.dispose();
                }, 5000);
            });

        this.logger.info(`Created new task, id: ${this.id}, process id: ${this.taskOptions.process.id}, context: ${this.context}`);
    }

    kill() {
        this.process.kill();
    }

    get command() {
        return this.taskOptions.command;
    }
    get process() {
        return this.taskOptions.process;
    }

    get id() {
        return this.taskId;
    }

    get context() {
        return this.taskOptions.context;
    }

    get processType() {
        return this.taskOptions.processType;
    }

    get label() {
        return this.taskOptions.label;
    }
}
