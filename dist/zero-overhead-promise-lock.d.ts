/**
 * Copyright 2024 Ori Cohen https://github.com/ori88c
 * https://github.com/ori88c/zero-overhead-promise-lock
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
export type AsyncTask<T> = () => Promise<T>;
/**
 * ZeroOverheadLock
 *
 * The `ZeroOverheadLock` class implements a Promise-lock for Node.js projects, enabling users
 * to ensure the mutually exclusive execution of specified tasks.
 *
 * In Node.js, synchronous code blocks - those that do *not* contain an `await` keyword - are
 * guaranteed to execute within a single event-loop iteration. These blocks inherently do not
 * require synchronization, as their execution is mutually exclusive by definition and cannot overlap.
 * In contrast, asynchronous tasks that include at least one `await`, necessarily span across multiple
 * event-loop iterations. Such tasks may require synchronization, when overlapping executions could
 * result in an inconsistent or invalid state.
 * A specific example illustrating this will be provided in the package README.
 *
 * ### Modern API Design
 * Traditional lock APIs require explicit acquire and release steps, adding overhead and
 * responsibility on the user.
 * In contrast, `ZeroOverheadLock` manages task execution, abstracting away these details and
 * reducing user responsibility. The acquire and release steps are handled implicitly by the
 * execution method, reminiscent of the RAII idiom in C++.
 *
 * ### Graceful Teardown
 * Task execution promises are tracked by the lock instance, ensuring no dangling promises.
 * This enables graceful teardown via the `waitForAllExistingTasksToComplete` method, in
 * scenarios where it is essential to ensure that all tasks - whether already executing or queued -
 * are fully processed before proceeding.
 * Examples include application shutdowns (e.g., `onModuleDestroy` in Nest.js applications)
 * or maintaining a clear state between unit tests.
 */
export declare class ZeroOverheadLock<T> {
    private _currentlyExecutingTask;
    /**
     * isAvailable
     *
     * Indicates whether the lock is currently available to immediately begin executing a new task.
     *
     * ### Check-and-Abort Friendly
     * This property is particularly useful in "check and abort" scenarios, where an operation
     * should be skipped or aborted if the lock is currently held by another task.
     *
     * @returns `true` if no task is currently executing; otherwise, `false`.
     */
    get isAvailable(): boolean;
    /**
     * executeExclusive
     *
     * This method executes the given task in a controlled manner, once the lock is available.
     * It resolves or rejects when the task finishes execution, returning the task's value or
     * propagating any error it may throw.
     *
     * @param criticalTask - The asynchronous task to execute exclusively, ensuring it does not
     *                       overlap with any other execution managed by this lock instance.
     * @throws - Error thrown by the task itself.
     * @returns A promise that resolves with the task's return value or rejects with its error.
     */
    executeExclusive(criticalTask: AsyncTask<T>): Promise<T>;
    /**
     * waitForAllExistingTasksToComplete
     *
     * Waits for the completion of all tasks that are *currently* pending or executing.
     *
     * This method is particularly useful in scenarios where it is essential to ensure that
     * all tasks - whether already executing or queued - are fully processed before proceeding.
     * Examples include application shutdowns (e.g., `onModuleDestroy` in Nest.js applications)
     * or maintaining a clear state between unit tests.
     *
     * ### Graceful Shutdown
     * The returned promise only accounts for tasks registered at the time this method is called.
     * If this method is being used as part of a graceful shutdown process, the **caller must ensure**
     * that no additional tasks are registered after this method is called.
     *
     * @returns A promise that resolves once all tasks that were pending or executing at the time
     *          of invocation are completed.
     */
    waitForAllExistingTasksToComplete(): Promise<void>;
    /**
     * _handleTaskExecution
     *
     * This method manages the execution of a given task in a controlled manner, i.e.,
     * updating the internal state on completion.
     *
     * ### Behavior
     * - Waits for the task to either return a value or throw an error.
     * - Updates the internal state to denote availability once the task is finished.
     *
     * @param criticalTask - The asynchronous task to execute exclusively, ensuring it does not
     *                       overlap with any other execution managed by this lock instance.
     * @returns A promise that resolves with the task's return value or rejects with its error.
     */
    _handleTaskExecution(criticalTask: AsyncTask<T>): Promise<T>;
}
