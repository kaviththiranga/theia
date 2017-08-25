/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as chai from 'chai';
import 'mocha';
import * as chaiAsPromised from 'chai-as-promised';
import { testContainer } from './test-resources/inversify.spec-config';
import { BackendApplication } from '@theia/core/lib/node/backend-application';
import { ITaskExitedEvent, ITaskInfo, ITaskServer, ITaskOptions, ProcessType } from '../common/task-protocol';
import { TaskWatcher } from '../common/task-watcher';
import * as ws from 'ws';
import * as http from 'http';
import { isWindows } from '@theia/core/lib/common/os';
import URI from "@theia/core/lib/common/uri";
import { FileUri } from "@theia/core/lib/node";

chai.use(chaiAsPromised);

/**
 * Globals
 */

const expect = chai.expect;

// test script
const command_relative_path = './task';
const command_relative_path_windows = 'task.bat';

const command_absolute_path_long_running = new URI(`file://${__dirname}`).resolve('test-resources').resolve('task-long-running');
const command_absolute_path_long_running_windows = new URI(`file://${__dirname}`).resolve('test-resources').resolve('task-long-running.bat');

const bogusCommand = 'thisisnotavalidcommand';
const command_to_find_in_path_unix = 'ls';
const command_to_find_in_path_windows = 'dir';

// use test-resources subfolder as workspace root for these tests
const wsRoot: string = FileUri.fsPath(new URI(__dirname).resolve('test-resources'));

describe('Task server / back-end', function () {
    this.timeout(10000);
    let server: http.Server;

    let taskServer: ITaskServer;
    const taskWatcher = testContainer.get(TaskWatcher);
    let application;

    before(async function () {
        // set theia workspace root to '<theia>/packages/task/src/node/test-resources/' folder
        process.argv.push(`--root-dir=${new URI(__dirname).path.join(__dirname, 'test-resources')}`);

        application = testContainer.get(BackendApplication);
        taskServer = testContainer.get(ITaskServer);
        taskServer.setClient(taskWatcher.getTaskClient());
        server = await application.start();
    });

    it("task running in terminal - is expected data received from the terminal ws server", async function () {
        const someString = 'someSingleWordString';

        // create task using terminal process
        const command = isWindows ? command_relative_path_windows : command_relative_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), [someString]), wsRoot);
        const terminalId = taskInfo.terminalId;

        // hook-up to terminal's ws and confirm that it outputs expected tasks' output
        const p = new Promise((resolve, reject) => {
            const socket = new ws(`ws://localhost:${server.address().port}/services/terminals/${terminalId}`);
            socket.on('message', msg => {
                // check output of task on terminal is what we expect
                const expected = `tasking... ${someString}`;
                if (msg.toString().indexOf(expected) !== -1) {
                    resolve();
                } else {
                    reject(`expected sub-string not found in terminal output. Expected: "${expected}" vs Actual: "${msg.toString()}"`);
                }

                socket.close();
            });
            socket.on('error', error => {
                reject(error);
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using raw process - task server success response shall not contain a terminal id", async function () {
        const someString = 'someSingleWordString';
        const command = isWindows ? command_relative_path_windows : command_relative_path;

        // create task using raw process
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), [someString]), wsRoot);

        const p = new Promise((resolve, reject) => {
            const toDispose = taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    if (taskInfo.terminalId === undefined) {
                        resolve();
                    } else {
                        reject(`terminal id was expected to be undefined, actual: ${taskInfo.terminalId}`);
                    }
                    toDispose.dispose();
                }
            });
        });

        return expect(p).to.be.eventually.fulfilled;
    });

    it("task is executed successfully using terminal process, command has absolute path", async function () {
        const command = isWindows ? command_relative_path_windows : command_relative_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), []), wsRoot);

        const p = checkSuccessfullProcessExit(taskInfo, taskWatcher);

        return expect(p).to.be.eventually.fulfilled;
    });

    it("task is executed successfully using raw process, command has absolute path", async function () {
        const command = isWindows ? command_relative_path_windows : command_relative_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), []));

        const p = checkSuccessfullProcessExit(taskInfo, taskWatcher);

        return expect(p).to.be.eventually.fulfilled;
    });

    it("task can successfully execute command found in system path using a terminal process", async function () {
        const command = isWindows ? command_to_find_in_path_windows : command_to_find_in_path_unix;

        const opts: ITaskOptions = createTaskOptions('terminal', command, []);
        const taskInfo: ITaskInfo = await taskServer.run(opts, wsRoot);

        const p = checkSuccessfullProcessExit(taskInfo, taskWatcher);

        return expect(p).to.be.eventually.fulfilled;
    });

    it("task can successfully execute command found in system path using a raw process", async function () {
        const command = isWindows ? command_to_find_in_path_windows : command_to_find_in_path_unix;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', command, []), wsRoot);

        const p = checkSuccessfullProcessExit(taskInfo, taskWatcher);

        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using terminal process can be killed", async function () {
        const command = isWindows ? command_absolute_path_long_running_windows : command_absolute_path_long_running;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), []), wsRoot);

        await taskServer.kill(taskInfo.taskId);

        const p = new Promise((resolve, reject) => {
            const toDispose = taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0 && event.signal !== '0') {
                    toDispose.dispose();
                    resolve();
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using raw process can be killed", async function () {
        const command = isWindows ? command_absolute_path_long_running_windows : command_absolute_path_long_running;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), []), wsRoot);

        await taskServer.kill(taskInfo.taskId);

        const p = new Promise((resolve, reject) => {
            const toDispose = taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === null && event.signal === 'SIGTERM') {
                    toDispose.dispose();
                    resolve();
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using terminal process can handle command that does not exist", async function () {
        if (!isWindows) {
            const p = taskServer.run(createTaskOptions('terminal', bogusCommand, []), wsRoot);
            return expect(p).to.be.eventually.rejectedWith(`Command not found: ${bogusCommand}`);
        } else {
            this.skip();
        }
    });

    it("task using raw process can handle command that does not exist", async function () {
        if (!isWindows) {
            const p = taskServer.run(createTaskOptions('raw', bogusCommand, []), wsRoot);
            return expect(p).to.be.eventually.rejectedWith(`Command not found: ${bogusCommand}`);
        } else {
            this.skip();
        }
    });

    it("getRunningTasks(ctx) returns tasks according to created context", async function () {
        const context1 = "aContext";
        const context2 = "anotherContext";

        const command = isWindows ? command_absolute_path_long_running_windows : command_absolute_path_long_running;

        // create some tasks: 4 for context1, 2 for context2
        const task1 = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), []), context1);
        const task2 = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), []), context2);
        const task3 = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), []), context1);
        const task4 = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), []), context2);
        const task5 = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), []), context1);
        const task6 = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), []), context1);

        const runningTasksCtx1 = await taskServer.getRunningTasks(context1); // should return 4 tasks
        const runningTasksCtx2 = await taskServer.getRunningTasks(context2); // should return 2 tasks
        const runningTasksAll = await taskServer.getRunningTasks(); // should return 6 tasks

        const p = new Promise((resolve, reject) => {
            if (runningTasksCtx1.length === 4) {
                if (runningTasksCtx2.length === 2) {
                    if (runningTasksAll.length === 6) {
                        resolve();
                    } else {
                        reject(`Error: unexpected total number of running tasks for all contexts:  expected: 6, actual: ${runningTasksCtx1.length}`);
                    }
                } else {
                    reject(`Error: unexpected number of running tasks for context 2: expected: 2, actual: ${runningTasksCtx1.length}`);
                }

            } else {
                reject(`Error: unexpected number of running tasks for context 1: expected: 4, actual: ${runningTasksCtx1.length}`);
            }
        });

        // cleanup
        await taskServer.kill(task1.taskId);
        await taskServer.kill(task2.taskId);
        await taskServer.kill(task3.taskId);
        await taskServer.kill(task4.taskId);
        await taskServer.kill(task5.taskId);
        await taskServer.kill(task6.taskId);

        return expect(p).to.be.eventually.fulfilled;
    });

});

function createTaskOptions(processType: ProcessType, command: string, args: string[]): ITaskOptions {
    const options: ITaskOptions = {
        label: "test task",
        isBuild: false,
        processType: processType,
        'processOptions': {
            'command': command,
            'args': args
        },
        "windowsProcessOptions": {
            "command": "cmd.exe",
            "args": [
                "/c",
                command
                ,
                (args[0] !== undefined) ? args[0] : ''
            ]
        },
        'cwd': wsRoot,
        'errorMatcherName': ''
    };
    return options;
}

function checkSuccessfullProcessExit(taskInfo: ITaskInfo, taskWatcher: TaskWatcher): Promise<object> {
    const p = new Promise((resolve, reject) => {
        const toDispose = taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
            if (event.taskId === taskInfo.taskId && event.code === 0) {
                toDispose.dispose();
                resolve();
            }
        });
    });
    return p;
}
