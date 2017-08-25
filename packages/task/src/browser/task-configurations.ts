/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from 'inversify';
import { ITaskOptions } from '../common/task-protocol';
import { ILogger, Disposable, DisposableCollection } from '@theia/core/lib/common/';
import URI from "@theia/core/lib/common/uri";
import { FileSystemWatcherServer, DidFilesChangedParams, FileChange } from '@theia/filesystem/lib/common/filesystem-watcher-protocol';
import { FileSystem } from '@theia/filesystem/lib/common';

export interface TaskConfigurationClient {
    tasksListChanged: (event: string[]) => void;
}

/**
 * Watches potentially two tasks.json files: one in the user's home directory (in $home/.theia/ ),
 * and  another one in the current workspace ( in $workspace/.theia/ )
 */
@injectable()
export class TaskConfigurations implements Disposable {

    /* Task client to send notifications to.  */
    protected readonly toDispose = new DisposableCollection();

    // Map where all the parsed tasks, from tasks.json files, are saved
    protected tasksMap = new Map<string, ITaskOptions>();

    // the tasks.json config file(s) we are watching
    protected watchedConfigFileUris: string[] = [];

    /** last directory element under which we look for task config */
    protected readonly TASKFILEPATH = '.theia';
    /** task configuration file name */
    protected readonly TASKFILE = 'tasks.json';

    protected client: TaskConfigurationClient | undefined = undefined;

    // comment-stripping JSON parser
    protected requireJSON = require('require-strip-json-comments');

    constructor(
        @inject(ILogger) protected readonly logger: ILogger,
        @inject(FileSystemWatcherServer) protected readonly watcherServer: FileSystemWatcherServer,
        @inject(FileSystem) protected readonly fileSystem: FileSystem
    ) {
        this.toDispose.push(watcherServer);
        watcherServer.setClient({
            onDidFilesChanged: changes =>
                this.onDidTaskFileChange(changes)
                    .then(() => {
                        this.getTaskLabels().then(tasks => {
                            if (this.client !== undefined) {
                                this.client.tasksListChanged(tasks);
                            }
                        });
                    })
                    .catch(err => {
                        this.logger.info(err);
                    })
        });

        this.toDispose.push(Disposable.create(() => {
            this.tasksMap.clear();
            this.client = undefined;
        }));
    }

    init(client: TaskConfigurationClient) {
        this.client = client;
    }

    dispose() {
        this.toDispose.dispose();
    }

    watchWorkspaceConfiguration(wsRootUri: string): Promise<void> {
        return this.watchConfigurationFile(wsRootUri);
    }

    protected watchConfigurationFile(rootDir: string): Promise<void> {
        return new Promise(resolve => {
            let configFile: string;
            this.getConfigFile(rootDir)
                .then(uri => {
                    // start watching that config file
                    configFile = uri;
                    if (this.watchedConfigFileUris.indexOf(configFile) === -1) {
                        this.watchedConfigFileUris.push(configFile);
                        this.watchConfigFile(configFile);
                    }

                })
                .then(() => {
                    this.readConfig(configFile)
                        .then(tasks => {
                            for (const task of tasks) {
                                this.tasksMap.set(task.label, task);
                            }
                            resolve();
                        })
                        .catch(err => {
                            this.logger.info(`Workspace: ${err}`);
                        });
                })
                .catch(err => {
                    this.logger.info(`Workspace: ${err}`);
                });
        });
    }

    protected readConfig(uri: string): Promise<ITaskOptions[]> {
        return new Promise((resolve, reject) => {
            const tasksFound: ITaskOptions[] = [];

            // read tasks defined in tasks.json
            this.readTasks(uri)
                .then(tasks => {
                    for (const task of tasks) {
                        tasksFound.push(task);
                    }
                    resolve(tasksFound);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    protected getConfigFile(rootDir: string): Promise<string> {
        return new Promise((resolve, reject) => {
            // compute URL of the tasks file to watch
            // const cfgFile = FileUri.fsPath(new URI(rootDir).resolve(this.TASKFILEPATH).resolve(this.TASKFILE));
            const cfgFile = new URI(rootDir).resolve(this.TASKFILEPATH).resolve(this.TASKFILE).toString();
            this.fileSystem.exists(cfgFile).then(exists => {
                if (exists) {
                    resolve(cfgFile);
                } else {
                    this.logger.info(`config file tasks.json does not exist under ${rootDir}`);
                    reject(`config file does not exist under: ${rootDir}`);
                }
            });
        });
    }

    getTaskLabels(): Promise<string[]> {
        return Promise.resolve([...this.tasksMap.keys()]);
    }

    getTask(taskLabel: string): Promise<ITaskOptions> {
        return new Promise((resolve, reject) => {
            if (this.tasksMap.has(taskLabel)) {
                resolve(this.tasksMap.get(taskLabel));
            } else {
                reject(`Task with label ${taskLabel} not found`);
            }
        });
    }

    protected watchConfigFile(uri: string): Promise<number> {
        // watch file for changes
        return new Promise(resolve => {
            this.watcherServer.watchFileChanges(uri).then(id => {
                this.toDispose.push(Disposable.create(() =>
                    this.watcherServer.unwatchFileChanges(id))
                );
                resolve(id);
            });
        });
    }

    // a task config file we're watching has changed - update task list
    protected onDidTaskFileChange(changes: DidFilesChangedParams): Promise<void> {
        return new Promise((resolve, reject) => {
            // one tasks.json file we're wathcing has changed?
            if (this.watchedFileChanged(changes.changes)) {
                this.tasksMap.clear();
                const promises: Promise<ITaskOptions[]>[] = [];

                // re-read all config files
                for (const fileUri of this.watchedConfigFileUris) {
                    promises.push(this.readTasks(fileUri));
                }

                Promise.all(promises)
                    .then(tasksArrayArray => {
                        for (const taskArray of tasksArrayArray) {
                            for (const task of taskArray) {
                                this.tasksMap.set(task.label, task);
                            }
                        }
                        resolve();
                    })
                    .catch(err => {
                        this.logger.error(err);
                        reject(err);
                    });
            }
        });
    }

    protected watchedFileChanged(changes: FileChange[]): boolean {
        for (const change of changes) {
            for (const file of this.watchedConfigFileUris) {
                // if (FileUri.fsPath(change.uri) === FileUri.fsPath(file)) {
                if (change.uri === file) {
                    return true;
                }
            }
        }
        return false;
    }

    protected readTasks(uri: string): Promise<ITaskOptions[]> {
        return new Promise((resolve, reject) => {
            this.fileSystem.exists(uri).then(exists => {
                if (!exists) {
                    reject(`tasks.json file does not exists: ${uri}`);
                }
                this.fileSystem.resolveContent(uri)
                    .then(({ stat, content }) => {
                        let tasks;
                        try {
                            tasks = this.requireJSON.parse(content);
                            resolve(this.filterDuplicates(tasks['tasks']));
                        } catch (err) {
                            reject(err);
                        }
                    })
                    .catch(err => {
                        reject(`Error(s) reading config file: ${uri}`);
                    });
            });
        });
    }

    private filterDuplicates(tasks: ITaskOptions[]): ITaskOptions[] {
        const filteredTasks: ITaskOptions[] = [];
        for (const task of tasks) {
            if (filteredTasks.some(t => t.label === task.label)) {
                this.logger.error(`Error parsing tasks.json: found duplicate entry for label ${task.label}`);
            } else {
                filteredTasks.push(task);
            }
        }
        return filteredTasks;
    }
}
