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
 * The `ZeroOverheadLock` class implements a Promise-lock for Node.js projects, enabling users
 * to ensure the mutually exclusive execution of specified tasks.
 *
 * ### Race Conditions: How Are They Possible in Single-Threaded JavaScript?
 * In Node.js, synchronous code blocks - those that do *not* contain an `await` keyword - are
 * guaranteed to execute within a single event-loop iteration. These blocks inherently do not
 * require synchronization, as their execution is mutually exclusive by definition and cannot
 * overlap.
 * In contrast, asynchronous tasks that include at least one `await`, necessarily span across
 * multiple event-loop iterations. Such tasks may require synchronization, when overlapping
 * executions could result in an inconsistent or invalid state.
 * In this regard, JavaScript's single-threaded nature differs inherently from that of
 * single-threaded C code, for example.
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
    private _pendingTasksCount;
    private _currentExecution?;
    /**
     * Availability indicator:
     * A pending `_waitForAvailability` promise signifies that the lock is currently held.
     * Its resolve function is used to notify all awaiters of a state change. This approach
     * has similarities with a condition_variable in C++.
     */
    private _waitForAvailablity?;
    private _notifyTaskCompletion?;
    /**
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
     * Exposes the currently executing task's promise, if one is active.
     *
     * ### Smart Reuse
     * This property is useful in scenarios where launching a duplicate task is wasteful.
     * Instead of scheduling a new task, consumers can await the ongoing execution to avoid
     * redundant operations.
     *
     * ### Usage Example
     * Suppose a route handler allows clients to fetch an aggregated usage summary
     * from a third-party service. Since this summary does not change frequently
     * and the request is expensive, it’s ideal to avoid triggering multiple
     * simultaneous fetches. Instead, reuse the ongoing execution:
     * ```ts
     * async function fetchSummary(): Promise<Summary> {
     *   const ongoing = summaryFetchLock.getCurrentExecution();
     *   if (ongoing) {
     *     return await ongoing;
     *   } else {
     *     return await summaryFetchLock.executeExclusive(fetchUsageSummary);
     *   }
     * }
     * ```
     *
     * @returns The currently executing task’s promise, or `undefined` if the lock is available.
     */
    get currentExecution(): Promise<T> | undefined;
    /**
     * Returns the number of tasks that are currently pending execution due to the lock being held.
     * These tasks are waiting for the lock to become available before they can proceed.
     *
     * ### Monitoring Backpressure
     * This property is useful for monitoring backpressure and making informed decisions, such as
     * dynamically adjusting task submission rates or triggering alerts if the backpressure grows
     * too large. Additionally, this metric can aid in internal resource management within a
     * containerized environment.
     *
     * ### Real-World Example: A Keyed Lock for Batch Processing of Kafka Messages
     * Suppose you are consuming a batch of Kafka messages from the same partition concurrently, but
     * need to ensure sequential processing for messages associated with the same key. For example,
     * each message may represent an action on a user account, where processing multiple actions
     * concurrently could lead to race conditions. Kafka experts might suggest increasing the number
     * of partitions to ensure sequential processing per partition. However, in practice, this approach
     * can be costly. As a result, it is not uncommon to prefer batch-processing messages from the same
     * partition rather than increasing the partition count.
     * To prevent concurrent processing of same-key messages during batch processing, you can use this
     * lock as a building block for a Keyed Lock, where each **key** is mapped to its own lock instance.
     * In this case, the key could be the UserID, ensuring that actions on the same user account are
     * processed sequentially.
     * When multiple locks exist - each associated with a unique key - the `pendingTasksCount` metric
     * can help optimize resource usage. Specifically, if a lock’s backpressure reaches 0, it may indicate
     * that the lock is no longer needed and can be **removed** from the Keyed Lock to free up resources.
     *
     * @returns The number of tasks currently waiting for execution.
     */
    get pendingTasksCount(): number;
    /**
     * This method executes the given task in a controlled manner, once the lock is available.
     * It resolves or rejects when the task finishes execution, returning the task's value or
     * propagating any error it may throw.
     *
     * @param criticalTask The asynchronous task to execute exclusively, ensuring it does not
     *                     overlap with any other execution managed by this lock instance.
     * @throws Error thrown by the task itself.
     * @returns A promise that resolves with the task's return value or rejects with its error.
     */
    executeExclusive(criticalTask: AsyncTask<T>): Promise<T>;
    /**
     * Waits for the completion of all tasks that are *currently* pending or executing.
     *
     * This method is particularly useful in scenarios where it is essential to ensure that
     * all tasks - whether already executing or queued - are fully processed before proceeding.
     * Examples include application shutdowns (e.g., `onModuleDestroy` in Nest.js applications)
     * or maintaining a clear state between unit tests.
     * This need is especially relevant in Kubernetes ReplicaSet deployments. When an HPA controller
     * scales down, pods begin shutting down gracefully.
     *
     * ### Graceful Shutdown
     * The returned promise only accounts for tasks registered at the time this method is called.
     * If this method is being used as part of a graceful shutdown process, the **caller must ensure**
     * that no additional tasks are registered after this method is called.
     * If there is any uncertainty about new tasks being registered, consider using the following pattern:
     * ```ts
     * while (!lock.isAvailable) {
     *   await lock.waitForAllExistingTasksToComplete()
     * }
     * ```
     *
     * @returns A promise that resolves once all tasks that were pending or executing at the time
     *          of invocation are completed.
     */
    waitForAllExistingTasksToComplete(): Promise<void>;
    /**
     * This method manages the execution of a given task in a controlled manner, i.e.,
     * updating the internal state on completion.
     *
     * ### Behavior
     * - Waits for the task to either return a value or throw an error.
     * - Updates the internal state to denote availability once the task is finished.
     *
     * @param criticalTask The asynchronous task to execute exclusively, ensuring it does not
     *                     overlap with any other execution managed by this lock instance.
     * @returns A promise that resolves with the task's return value or rejects with its error.
     */
    _handleTaskExecution(criticalTask: AsyncTask<T>): Promise<T>;
}
