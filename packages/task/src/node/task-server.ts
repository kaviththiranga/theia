/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from 'inversify';
import { ILogger, DisposableCollection } from '@theia/core/lib/common/';
import { ITaskClient, ITaskExitedEvent, ITaskInfo, ITaskOptions, ITaskServer } from '../common/task-protocol';
import { Task, TaskFactory, TaskOptions } from './task';
import { RawProcess, RawProcessFactory, RawProcessOptions } from '@theia/process/lib/node/raw-process';
import { TerminalProcess, TerminalProcessFactory, TerminalProcessOptions } from '@theia/process/lib/node/terminal-process';
import { TaskManager } from './task-manager';
import * as fs from 'fs';
import * as path from 'path';
import URI from "@theia/core/lib/common/uri";
import { FileSystem } from '@theia/filesystem/lib/common';
import { isWindows } from '@theia/core/lib/common/os';
import { FileUri } from "@theia/core/lib/node";

@injectable()
export class TaskServer implements ITaskServer {

    /* Task clients to send notifications to.  */
    protected clients: ITaskClient[] = [];
    protected taskToDispose = new Map<number, DisposableCollection>();
    protected readonly toDispose = new DisposableCollection();

    constructor(
        @inject(ILogger) protected readonly logger: ILogger,
        @inject(RawProcessFactory) protected readonly rawProcessFactory: RawProcessFactory,
        @inject(TerminalProcessFactory) protected readonly terminalProcessFactory: TerminalProcessFactory,
        @inject(TaskManager) protected readonly taskManager: TaskManager,
        @inject(FileSystem) protected readonly fileSystem: FileSystem,
        @inject(TaskFactory) protected readonly taskFactory: TaskFactory
    ) {
        const taskManagerListener = taskManager.onDelete(id => {
            const toDispose = this.taskToDispose.get(id);
            if (toDispose !== undefined) {
                toDispose.dispose();
                this.taskToDispose.delete(id);
            }
        });
        this.toDispose.push(taskManagerListener);
    }

    dispose() {
        // do nothing
    }

    // remove client that has disconnected
    disposeConnection(client: ITaskClient) {
        const idx = this.clients.indexOf(client);
        if (idx > -1) {
            this.clients.splice(idx, 1);
        }
    }

    getRunningTasks(context?: string | undefined): Promise<ITaskInfo[]> {
        const taskinfo: ITaskInfo[] = [];

        const tasks = this.taskManager.getTasks(context);
        if (tasks !== undefined) {
            for (const task of tasks) {
                taskinfo.push(
                    {
                        taskId: task.id,
                        terminalId: (task.processType === 'terminal') ? task.process.id : undefined,
                        processId: task.process.id,
                        osProcessId: task.process.pid,
                        command: task.command,
                        label: task.label
                    });
            }
        }
        return Promise.resolve(taskinfo);
    }

    run(task: ITaskOptions, ctx?: string): Promise<ITaskInfo> {
        return new Promise(async (resolve, reject) => {
            try {
                resolve(await this.doRun(task, ctx));
            } catch (err) {
                reject(new Error(err));
            }
        });
    }

    protected doRun(options: ITaskOptions, ctx?: string): Promise<ITaskInfo> {
        return new Promise<ITaskInfo>(async (resolve, reject) => {
            // on windows, prefer windows-specific options, if available
            const processOptions = (isWindows && options.windowsProcessOptions !== undefined) ?
                options.windowsProcessOptions : options.processOptions;

            const command = processOptions.command;

            if (processOptions.options === undefined) {
                processOptions.options = {
                    'cwd': '',
                    'env': ''
                };
            }

            let cwd = options.cwd;
            cwd = FileUri.fsPath(cwd);

            // Use task's cwd with spawned process
            processOptions.options.cwd = cwd;
            // pass node env to new process, so e.g. we can re-use the system path
            processOptions.options.env = process.env;

            this.findCommand(command, cwd)
                .then(cmd => {
                    try {
                        // use terminal or raw process
                        let task: Task;
                        let proc: TerminalProcess | RawProcess;

                        if (options.processType === 'terminal') {
                            this.logger.info('Task: creating underlying terminal process');
                            proc = this.terminalProcessFactory(<TerminalProcessOptions>processOptions);
                        } else {
                            this.logger.info('Task: creating underlying raw process');
                            proc = this.rawProcessFactory(<RawProcessOptions>processOptions);
                        }

                        task = this.taskFactory(<TaskOptions>
                            {
                                label: options.label,
                                command: cmd,
                                process: proc,
                                processType: options.processType,
                                context: ctx
                            });

                        const toDispose = new DisposableCollection();

                        toDispose.push(
                            // when underlying process exits, notify tasks listeners
                            proc.onExit(event => {

                                this.fireTaskExitedEvent({
                                    'taskId': task.id,
                                    'code': event.code,
                                    'signal': event.signal,
                                    'ctx': ctx === undefined ? '' : ctx
                                });
                            })
                        );

                        this.taskToDispose.set(task.id, toDispose);

                        resolve(
                            {
                                taskId: task.id,
                                osProcessId: proc.pid,
                                terminalId: (options.processType === 'terminal') ? proc.id : undefined,
                                processId: (options.processType === 'raw') ? proc.id : undefined,
                                command: cmd,
                                label: options.label
                            }
                        );

                    } catch (error) {
                        this.logger.error(`Error occured while creating task: ${error}`);
                        reject(new Error(error));
                    }
                })
                .catch(err => {
                    reject(new Error(err));
                });

        });
    }

    protected fireTaskExitedEvent(event: ITaskExitedEvent) {
        this.logger.debug(log => log(`task has exited:`, event));
        // notify all clients. They can filter on context to see if it's relevant to them
        this.clients.forEach(client => {
            client.onTaskExit(event);
        });

    }

    kill(id: number): Promise<void> {
        const taskToKill = this.taskManager.get(id);
        if (taskToKill !== undefined) {
            taskToKill.kill();
        }
        return Promise.resolve();
    }

    /** Set the client we send the notifications-to. We expect that there might be
     * multiple clients, so add them to a list as they are set
     */
    setClient(client: ITaskClient) {
        this.clients.push(client);
    }

    // Check if task command/script can be found on the target system. The command
    // can sometimes be found in a path relative to the cwd. It can sometimes
    // be found in one of the system paths. It can also be found in an absolute
    // path, when provided.
    private async findCommand(command: string, cwd: string): Promise<string> {
        const systemPath = process.env.PATH;

        return new Promise<string>(async (resolve, reject) => {

            if (path.isAbsolute(command)) {
                if (await this.fileExists(command)) {
                    resolve(command);
                    return;
                } else {
                    const uri = new URI(cwd).resolve(command);
                    const resolved_command = FileUri.fsPath(uri);
                    if (await this.fileExists(resolved_command)) {
                        resolve(resolved_command);
                        return;
                    }
                }
            } else {
                // look for command relative to cwd
                const resolved_command = FileUri.fsPath(new URI(cwd).resolve(command));

                if (await this.fileExists(resolved_command)) {
                    resolve(resolved_command);
                    return;
                } else {
                    // should cover Unix and Windows cases
                    const separator = /;|:/;
                    // just a command to find in the system path?
                    if (path.basename(command) === command) {
                        // search for this command in the system path
                        if (systemPath !== undefined) {
                            const pathArray: string[] = systemPath.split(separator);

                            for (const p of pathArray) {
                                const candidate = FileUri.fsPath(new URI(p).resolve(command));
                                if (await this.fileExists(candidate)) {
                                    resolve(candidate);
                                    return;
                                }
                            }
                        }
                    }
                }

            }
            reject(`Command not found: ${command}`);
        });
    }

    async fileExists(filePath: string): Promise<boolean> {
        return new Promise<boolean>(async (resolve, reject) => {
            // file is accessible (read, execute)?
            fs.access(filePath, fs.constants.F_OK | fs.constants.X_OK, err => {
                resolve(err ? false : true);
            });
        });

    }
}
