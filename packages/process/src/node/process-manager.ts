/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
import { injectable, inject } from 'inversify';
import { Process } from './process';
import { Emitter, Event } from '@theia/core/lib/common';
import { ILogger } from '@theia/core/lib/common/logger';
import { BackendApplicationContribution } from '@theia/core/lib/node';

@injectable()
export class ProcessManager implements BackendApplicationContribution {

    protected id: number = 0;
    protected readonly processes: Map<number, Process>;
    protected readonly deleteEmitter: Emitter<number>;

    constructor( @inject(ILogger) protected logger: ILogger) {
        this.processes = new Map();
        this.deleteEmitter = new Emitter<number>();
    }

    register(process: Process): number {
        const id = this.id;
        this.processes.set(id, process);
        this.id++;
        return id;
    }

    /**
     * Removes the process from this process manager. Invoking this method, will make
     * sure that the process is terminated before eliminating it from the manager's cache.
     *
     * @param process the process to unregister from this process manager.
     */
    unregister(process: Process): void {
        if (!process.killed) {
            process.kill();
            return;
        }
        if (this.processes.delete(process.id)) {
            this.deleteEmitter.fire(process.id);
        }
    }

    get(id: number): Process | undefined {
        return this.processes.get(id);
    }

    get onDelete(): Event<number> {
        return this.deleteEmitter.event;
    }

    onStop?(): void {
        for (const process of this.processes.values()) {
            try {
                this.unregister(process);
            } catch (error) {
                this.logger.error(`Error occurred when terminating process. PID: ${process.pid}.`, error);
            }
        }
    }

}
