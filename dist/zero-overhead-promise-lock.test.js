"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const zero_overhead_promise_lock_1 = require("./zero-overhead-promise-lock");
/**
 * resolveFast
 *
 * The one-and-only purpose of this function, is triggerring an event-loop iteration.
 * It is relevant whenever a test needs to simulate tasks from the Node.js' micro-tasks queue.
 */
const resolveFast = async () => {
    expect(14).toBeGreaterThan(3);
};
describe('ZeroOverheadLock tests', () => {
    describe('Happy path tests', () => {
        test('executeExclusive: should return the expected value when succeeds', async () => {
            const lock = new zero_overhead_promise_lock_1.ZeroOverheadLock();
            expect(lock.isAvailable).toBe(true);
            expect(lock.pendingTasksCount).toBe(0);
            const expectedValue = -295;
            const task = async () => { return expectedValue; };
            const actualValue = await lock.executeExclusive(task);
            expect(actualValue).toBe(expectedValue);
            expect(lock.isAvailable).toBe(true);
            expect(lock.pendingTasksCount).toBe(0);
        });
        test('waitForAllExistingTasksToComplete: should resolve immediately if no task currently executes', async () => {
            const lock = new zero_overhead_promise_lock_1.ZeroOverheadLock();
            await lock.waitForAllExistingTasksToComplete();
            expect(lock.isAvailable).toBe(true);
            expect(lock.pendingTasksCount).toBe(0);
        });
        test('executeExclusive: should process only one task at a time, and waitForAllExistingTasksToComplete ' +
            'should resolve only after *all* the currently pending and processed tasks are completed', async () => {
            const lock = new zero_overhead_promise_lock_1.ZeroOverheadLock();
            const numberOfTasks = 225;
            const taskCompletionCallbacks = [];
            const executeExclusivePromises = [];
            let expectedBackpressure;
            // Create a burst of tasks, inducing backpressure on the lock.
            for (let ithTask = 0; ithTask < numberOfTasks; ++ithTask) {
                const jobPromise = new Promise(res => taskCompletionCallbacks[ithTask] = res);
                const job = () => jobPromise;
                // Tasks will be executed in the order in which they were registered.
                executeExclusivePromises[ithTask] = lock.executeExclusive(job);
                // Trigger the event loop, allowing the lock to evaluate if the current task can begin execution.
                // Based on this test's configuration, only the first task will be allowed to start.
                await Promise.race([
                    executeExclusivePromises[ithTask],
                    resolveFast()
                ]);
                expect(lock.isAvailable).toBe(false);
                // Only the first task does not induce backpressure, as it can start immediately.
                expectedBackpressure = ithTask;
                expect(lock.pendingTasksCount).toBe(expectedBackpressure);
            }
            let allTasksCompleted = false;
            const waitForCompletionOfAllTasksPromise = (async () => {
                await lock.waitForAllExistingTasksToComplete();
                allTasksCompleted = true;
            })();
            const lastTaskIndex = numberOfTasks - 1;
            expectedBackpressure = lastTaskIndex;
            for (let ithTask = 0; ithTask < numberOfTasks; ++ithTask) {
                // At this stage, all tasks are pending for execution, except one which has started
                // (the ithTask).
                expect(lock.isAvailable).toBe(false);
                expect(lock.pendingTasksCount).toBe(expectedBackpressure);
                expect(allTasksCompleted).toBe(false);
                // Complete the current task.
                // Note: the order in which tasks start execution corresponds to the order in which
                // `executeExclusive` was invoked.
                const finishCurrentTask = taskCompletionCallbacks[ithTask];
                finishCurrentTask();
                const isLastTask = ithTask === lastTaskIndex;
                if (isLastTask) {
                    await Promise.all([executeExclusivePromises[ithTask], waitForCompletionOfAllTasksPromise]);
                }
                else {
                    await Promise.race([executeExclusivePromises[ithTask], waitForCompletionOfAllTasksPromise]);
                    --expectedBackpressure;
                }
            }
            expect(lock.isAvailable).toBe(true);
            expect(lock.pendingTasksCount).toBe(0);
            expect(allTasksCompleted).toBe(true);
        });
        /**
         * Note: While fundamentally different, the technique of multiple promises awaiting
         * the same shared promise instance is somewhat reminiscent of `std::condition_variable` in C++.
         * Instead of coordinating multiple threads, this approach coordinates multiple promise instances.
         */
        test('when _currentlyExecutingTask resolves, its awaiters should be executed according to their ' +
            'order in the Node.js microtasks queue', async () => {
            // This test does not directly assess the lock component. Instead, it verifies the
            // correctness of the **shared promise instance** acquire mechanism, ensuring it honors
            // the FIFO order of callers requesting the (one and only) execution slot.
            // In JavaScript, it is common for a caller to create a promise (as the **sole owner** of
            // this promise instance) and await its resolution. It is less common for multiple promises
            // to await concurrently on the same shared promise instance. In that scenario, a pertinent
            // question arises:
            // In which *order* will the multiple awaiters be executed?
            // Short answer: according to their order in the Node.js microtasks queue.
            // Long answer:
            // When a promise is resolved, the callbacks attached to it (other promises awaiting
            // its resolution) are *queued* as microtasks. Therefore, if multiple awaiters are waiting on
            // the same shared promise instance, and the awaiters were created in a *specific* order, the
            // first awaiter will be executed first once the shared promise is resolved. This is because
            // adding a microtask (such as an async function awaiting a promise) ensures its position in
            // the microtasks queue, guaranteeing its execution before subsequent microtasks in the queue.
            // This holds true for any position, i.e., it can be generalized.
            // In the following test, a relatively large number of awaiters is chosen. The motive is
            // to observe statistical errors, which should *not* exist regardless of the input size.
            const numberOfAwaiters = 384;
            const actualExecutionOrderOfAwaiters = [];
            // This specific usage of one promise instance being awaited by multiple other promises
            // may remind those with a C++ background of a condition_variable.
            let notifyAvailability;
            const waitForAvailability = new Promise(res => notifyAvailability = res);
            const awaiterAskingToAcquireLock = async (awaiterID) => {
                await waitForAvailability;
                actualExecutionOrderOfAwaiters.push(awaiterID);
                // Other awaiters in the microtasks queue will now be notified about the
                // fulfillment of 'waitForAvailability'.
            };
            const expectedExecutionOrder = [];
            const awaiterPromises = [];
            for (let awaiterID = 0; awaiterID < numberOfAwaiters; ++awaiterID) {
                expectedExecutionOrder.push(awaiterID);
                awaiterPromises.push(awaiterAskingToAcquireLock(awaiterID));
            }
            // Initially, no awaiter should be able to make progress.
            await Promise.race([...awaiterPromises, resolveFast()]);
            expect(actualExecutionOrderOfAwaiters.length).toBe(0);
            // Notify that an "execution slot" is available, triggering the awaiters *in order*.
            notifyAvailability();
            await Promise.all(awaiterPromises);
            // The execution order should match the expected order.
            expect(actualExecutionOrderOfAwaiters).toEqual(expectedExecutionOrder);
            ;
        });
    });
    describe('Negative path tests', () => {
        test('executeExclusive: should return the expected error when throws', async () => {
            const lock = new zero_overhead_promise_lock_1.ZeroOverheadLock();
            const expectedError = new Error('mock error');
            const task = async () => { throw expectedError; };
            expect.assertions(3);
            try {
                await lock.executeExclusive(task);
            }
            catch (err) {
                expect(err).toBe(expectedError);
            }
            expect(lock.isAvailable).toBe(true);
            expect(lock.pendingTasksCount).toBe(0);
        });
        test('executeExclusive: should process only one task at a time, and waitForAllExistingTasksToComplete ' +
            'should resolve only after *all* the currently pending and processed tasks are completed, ' +
            'with all tasks rejecting', async () => {
            const lock = new zero_overhead_promise_lock_1.ZeroOverheadLock();
            const numberOfTasks = 90;
            const taskRejectCallbacks = [];
            const executeExclusivePromises = [];
            let expectedBackpressure;
            // Create a burst of tasks, inducing backpressure on the lock.
            for (let ithTask = 0; ithTask < numberOfTasks; ++ithTask) {
                const jobPromise = new Promise((_, rej) => taskRejectCallbacks[ithTask] = rej);
                const job = () => jobPromise;
                // Tasks will be executed in the order in which they were registered.
                executeExclusivePromises[ithTask] = lock.executeExclusive(job);
                // Trigger the event loop, allowing the lock to evaluate if the current task can begin execution.
                // Based on this test's configuration, only the first task will be allowed to start.
                await Promise.race([
                    executeExclusivePromises[ithTask],
                    resolveFast()
                ]);
                expect(lock.isAvailable).toBe(false);
                // Only the first task does not induce backpressure, as it can start immediately.
                expectedBackpressure = ithTask;
                expect(lock.pendingTasksCount).toBe(expectedBackpressure);
            }
            let allTasksCompleted = false;
            const waitForCompletionOfAllTasksPromise = (async () => {
                await lock.waitForAllExistingTasksToComplete();
                allTasksCompleted = true;
            })();
            const lastTaskIndex = numberOfTasks - 1;
            expectedBackpressure = lastTaskIndex;
            for (let ithTask = 0; ithTask < numberOfTasks; ++ithTask) {
                // At this stage, all tasks are pending for execution, except one which has started
                // (the ithTask).
                expect(lock.isAvailable).toBe(false);
                expect(lock.pendingTasksCount).toBe(expectedBackpressure);
                expect(allTasksCompleted).toBe(false);
                // Complete the current task.
                // Note: the order in which tasks start execution corresponds to the order in which
                // `executeExclusive` was invoked.
                const rejectCurrentTask = taskRejectCallbacks[ithTask];
                const currError = new Error(`${ithTask}`);
                rejectCurrentTask(currError);
                const isLastTask = ithTask === lastTaskIndex;
                try {
                    if (isLastTask) {
                        await Promise.all([executeExclusivePromises[ithTask], waitForCompletionOfAllTasksPromise]);
                    }
                    else {
                        await Promise.race([executeExclusivePromises[ithTask], waitForCompletionOfAllTasksPromise]);
                    }
                    expect(true).toBe(false); // The flow should not reach this point.
                }
                catch (err) {
                    expect(err).toBe(currError);
                }
                if (!isLastTask) {
                    --expectedBackpressure;
                }
            }
            expect(lock.isAvailable).toBe(true);
            expect(lock.pendingTasksCount).toBe(0);
            expect(allTasksCompleted).toBe(true);
        });
    });
});
//# sourceMappingURL=zero-overhead-promise-lock.test.js.map