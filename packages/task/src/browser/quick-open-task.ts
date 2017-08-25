/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from "inversify";
import { TaskService } from './task-service';
import { ITaskInfo } from '../common/task-protocol';
import { QuickOpenService, QuickOpenModel, QuickOpenItem, QuickOpenMode } from '@theia/core/lib/browser/quick-open/';

@injectable()
export class QuickOpenTask implements QuickOpenModel {

    private items: QuickOpenItem[];

    constructor(
        @inject(TaskService) protected readonly taskService: TaskService,
        @inject(QuickOpenService) protected readonly quickOpenService: QuickOpenService
    ) { }

    open(): void {
        this.items = [];

        this.taskService.getTasks().then(tasks => {
            for (const task of tasks) {
                this.items.push(new TaskRunQuickOpenItem(task, this.taskService));
            }
            this.quickOpenService.open(this, {
                placeholder: 'Type the name of a task you want to execute',
                fuzzyMatchLabel: true,
                fuzzySort: true
            });
        });
    }

    attach(): void {
        this.items = [];

        this.taskService.getRunningTasks().then(tasks => {
            for (const task of tasks) {
                // can only attach to terminal processes
                if (task.terminalId) {
                    this.items.push(new TaskAttachQuickOpenItem(
                        task,
                        this.getRunningTaskLabel(task),
                        this.taskService));
                }
            }
            this.quickOpenService.open(this, {
                placeholder: 'Choose task to open',
                fuzzyMatchLabel: true,
                fuzzySort: true
            });
        });
    }

    public getItems(lookFor: string): QuickOpenItem[] {
        return this.items;
    }

    onType(lookFor: string, acceptor: (items: QuickOpenItem[]) => void): void {
        acceptor(this.items);
    }

    protected getRunningTaskLabel(task: ITaskInfo): string {
        return `Task id: ${task.taskId}, label: ${task.label}`;
    }

}

export class TaskRunQuickOpenItem extends QuickOpenItem {

    private activeElement: HTMLElement;

    constructor(
        protected readonly taskLabel: string,
        protected taskService: TaskService
    ) {
        super();
        this.activeElement = window.document.activeElement as HTMLElement;
    }

    getLabel(): string {
        return this.taskLabel!;
    }

    run(mode: QuickOpenMode): boolean {
        if (mode !== QuickOpenMode.OPEN) {
            return false;
        }
        // reset focus on the previously active element.
        this.activeElement.focus();
        this.taskService.run(this.taskLabel);

        return true;
    }
}

//
export class TaskAttachQuickOpenItem extends QuickOpenItem {

    private activeElement: HTMLElement;

    constructor(
        protected readonly task: ITaskInfo,
        protected readonly taskLabel: string,
        protected taskService: TaskService
    ) {
        super();
        this.activeElement = window.document.activeElement as HTMLElement;
    }

    getLabel(): string {
        return this.taskLabel!;
    }

    run(mode: QuickOpenMode): boolean {
        if (mode !== QuickOpenMode.OPEN) {
            return false;
        }
        if (this.task.processId) {
            // reset focus on the previously active element.
            this.activeElement.focus();
            // this.taskService.run(this.taskLabel);
            this.taskService.attach(this.task.processId, this.task.taskId);
        }
        return true;
    }
}