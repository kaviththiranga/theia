/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
import { injectable } from 'inversify';
import { Task } from './task';
import { Emitter, Event, Disposable } from '@theia/core/lib/common';

// inspired by process-manager.ts

@injectable()
export class TaskManager implements Disposable {

    /** contains all running tasks */
    protected readonly tasks: Map<number, Task> = new Map();
    /** contains running tasks per context */
    protected readonly tasksPerCtx: Map<string, Task[]> = new Map();
    /** each task has this unique task id, for this back-end */
    protected id: number = -1;
    protected readonly deleteEmitter = new Emitter<number>();

    register(task: Task, ctx: string): number {
        const id = ++this.id;
        this.tasks.set(id, task);

        let tks = this.tasksPerCtx.get(ctx);
        if (tks === undefined) {
            tks = [];
        }
        tks.push(task);
        this.tasksPerCtx.set(ctx, tks);

        return id;
    }

    get(id: number): Task | undefined {
        return this.tasks.get(id);
    }

    /**
     * Returns all running tasks. If a context is provided, filter-down to
     * only tasks started from that context
     */
    getTasks(ctx?: string): Task[] | undefined {
        if (ctx === undefined) {
            return [...this.tasks.values()];
        } else {
            if (this.tasksPerCtx.has(ctx)) {
                return this.tasksPerCtx.get(ctx);
            }
        }
    }

    delete(task: Task): void {
        this.tasks.delete(task.id);

        const wsRoot = task.context;
        if (this.tasksPerCtx.has(wsRoot)) {
            const tasksForWS = this.tasksPerCtx.get(wsRoot);
            if (tasksForWS !== undefined) {
                const idx = tasksForWS.indexOf(task);
                tasksForWS.splice(idx, 1);
            }
        }
        this.deleteEmitter.fire(task.id);
    }

    get onDelete(): Event<number> {
        return this.deleteEmitter.event;
    }

    dispose() {
        this.tasks.clear();
    }
}
