/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable } from "inversify";
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ITaskClient, ITaskExitedEvent, ITaskOutputEntryFoundEvent } from './task-protocol';

@injectable()
export class TaskWatcher {

    getTaskClient(): ITaskClient {
        const exitEmitter = this.onTaskExitEmitter;
        const entryFoundEmitter = this.onTaskentryFoundEmitter;
        return {
            onTaskExit(event: ITaskExitedEvent) {
                exitEmitter.fire(event);
            },
            onTaskOutputEntryFound(event: ITaskOutputEntryFoundEvent) {
                entryFoundEmitter.fire(event);
            }
        };
    }

    private onTaskExitEmitter = new Emitter<ITaskExitedEvent>();
    private onTaskentryFoundEmitter = new Emitter<ITaskOutputEntryFoundEvent>();

    get onTaskExit(): Event<ITaskExitedEvent> {
        return this.onTaskExitEmitter.event;
    }

    get onTaskOutputEntryFound(): Event<ITaskOutputEntryFoundEvent> {
        return this.onTaskentryFoundEmitter.event;
    }
}
