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

/**
 * General note on testing concurrency in unit tests:
 * While ideal tests follow a strict Arrange-Act-Assert structure, rigorously testing
 * concurrency-oriented components often requires validating intermediate states.
 * Incorrect intermediate states can compromise the entire component's correctness,
 * making their verification essential.
 * 
 * As with everything in engineering, this comes at a cost: verbosity. 
 * Given that resilience is the primary goal, this is a small price to pay.
 */

import { ZeroOverheadLock } from './zero-overhead-promise-lock';

type PromiseResolveCallbackType = (value?: unknown) => void;
type PromiseRejectCallbackType = (err?: Error) => void;

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

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
      const lock = new ZeroOverheadLock<number>();
      expect(lock.isAvailable).toBe(true);
      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.currentExecution).toBe(undefined);

      const expectedValue = -295;
      const task = async (): Promise<number> => { return expectedValue; };
      const actualValue = await lock.executeExclusive(task);
      expect(actualValue).toBe(expectedValue);
      expect(lock.isAvailable).toBe(true);
      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.currentExecution).toBe(undefined);
    });
  
    test('waitForAllExistingTasksToComplete: should resolve immediately if no task currently executes', async () => {
      const lock = new ZeroOverheadLock<number>();
      await lock.waitForAllExistingTasksToComplete();
      expect(lock.isAvailable).toBe(true);
      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.currentExecution).toBe(undefined);
    });

    test(
      'executeExclusive: should process only one task at a time, and waitForAllExistingTasksToComplete ' +
      'should resolve only after *all* the currently pending and processed tasks are completed', async () => {
      const lock = new ZeroOverheadLock<void>();
      const numberOfTasks = 225;
      const taskCompletionCallbacks: PromiseResolveCallbackType[] = [];
      const executeExclusivePromises: Promise<void>[] = [];
      let expectedBackpressure: number;

      // Create a burst of tasks, inducing backpressure on the lock.
      for (let ithTask = 0; ithTask < numberOfTasks; ++ithTask) {
        const jobPromise = new Promise<void>(res => taskCompletionCallbacks[ithTask] = res);
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
        expect(lock.currentExecution).toBeDefined();
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
        expect(lock.currentExecution).toBeDefined();
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
        } else {
          await Promise.race([executeExclusivePromises[ithTask], waitForCompletionOfAllTasksPromise]);
          --expectedBackpressure;
        }
      }

      expect(lock.isAvailable).toBe(true);
      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.currentExecution).toBe(undefined);
      expect(allTasksCompleted).toBe(true);
    });

    test('currentExecution getter should return the active task promise during execution', async () => {
      type ResultType = Record<string, number>;
      const mockResult: ResultType = { a: 1, b: 2 };

      let resolveTask: PromiseResolveCallbackType;
      const lock = new ZeroOverheadLock<ResultType>();

      // Pre-constructed task promise to verify identity.
      const taskPromise = new Promise<ResultType>(res => resolveTask = res);
      const executeExclusivePromise = lock.executeExclusive(() => taskPromise);

      const validationRounds = 24;
      for (let attempt = 0; attempt < validationRounds; ++attempt) {
        expect(lock.isAvailable).toBe(false);

        // currentExecution should return the exact Promise instance.
        expect(lock.currentExecution).toBe(taskPromise);
        expect(lock.pendingTasksCount).toBe(0);
      }

      resolveTask(mockResult);
      const result = await executeExclusivePromise;
      expect(result).toBe(mockResult);

      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.isAvailable).toBe(true);
      expect(lock.currentExecution).toBe(undefined);
    });

    /**
     * Note: While fundamentally different, the technique of multiple promises awaiting 
     * the same shared promise instance is somewhat reminiscent of `std::condition_variable` in C++. 
     * Instead of coordinating multiple threads, this approach coordinates multiple promise instances.
     */
    test(
      'when _currentlyExecutingTask resolves, its awaiters should be executed according to their ' +
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
      const actualExecutionOrderOfAwaiters: number[] = [];
        
      // This specific usage of one promise instance being awaited by multiple other promises
      // may remind those with a C++ background of a condition_variable.
      let notifyAvailability: PromiseResolveCallbackType;
      const waitForAvailability = new Promise(res => notifyAvailability = res);

      const awaiterAskingToAcquireLock = async (awaiterID: number): Promise<void> => {
        await waitForAvailability;
        actualExecutionOrderOfAwaiters.push(awaiterID);
        // Other awaiters in the microtasks queue will now be notified about the
        // fulfillment of 'waitForAvailability'.
      }

      const expectedExecutionOrder: number[] = [];
      const awaiterPromises: Promise<void>[] = [];
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
    });
  });

  describe('Negative path tests', () => {
    test('executeExclusive: should return the expected error when throws', async () => {
      const lock = new ZeroOverheadLock<string>();
      const expectedError = new Error('mock error');
      const task = async (): Promise<string> => { throw expectedError; };

      expect.assertions(4);
      try {
        await lock.executeExclusive(task);
      } catch (err) {
        expect(err).toBe(expectedError);
      }

      expect(lock.isAvailable).toBe(true);
      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.currentExecution).toBe(undefined);
    });

    test(
      'executeExclusive: should process only one task at a time, and waitForAllExistingTasksToComplete ' +
      'should resolve only after *all* the currently pending and processed tasks are completed, ' +
      'with all tasks rejecting', async () => {
      const lock = new ZeroOverheadLock<void>();
      const numberOfTasks = 90;
      const taskRejectCallbacks: PromiseRejectCallbackType[] = [];
      const executeExclusivePromises: Promise<void>[] = [];
      let expectedBackpressure: number;

      // Create a burst of tasks, inducing backpressure on the lock.
      for (let ithTask = 0; ithTask < numberOfTasks; ++ithTask) {
        const taskPromise = new Promise<void>((_, rej) => taskRejectCallbacks[ithTask] = rej);
        const createTask = () => taskPromise;

        // Tasks will be executed in the order in which they were registered.
        executeExclusivePromises[ithTask] = lock.executeExclusive(createTask);

        // Trigger the event loop, allowing the lock to evaluate if the current task can begin execution.
        // Based on this test's configuration, only the first task will be allowed to start.
        await Promise.race([
          executeExclusivePromises[ithTask],
          resolveFast()
        ]);
        expect(lock.isAvailable).toBe(false);
        expect(lock.currentExecution).toBeDefined();
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
        expect(lock.currentExecution).toBeDefined();
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
          } else {
            await Promise.race([executeExclusivePromises[ithTask], waitForCompletionOfAllTasksPromise]);
          }

          expect(true).toBe(false); // The flow should not reach this point.
        } catch (err) {
            expect(err).toBe(currError);
        }

        if (!isLastTask) {
          --expectedBackpressure;
        }
      }

      expect(lock.isAvailable).toBe(true);
      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.currentExecution).toBe(undefined);
      expect(allTasksCompleted).toBe(true);
    });
  });

  describe('Resilience tests: mixed scenarios', () => {
    test(
      'executeExclusive: should enforce exclusivity, and waitForAllExistingTasksToComplete should ' +
      'resolve only after all pending and executing tasks (both successful and failing) finish', async () => {
      // Arrange.
      jest.useFakeTimers();
      const lock = new ZeroOverheadLock<number>();
      const taskDurationMs = 15 * 1000;
      const tasksCount = 231 ;
      const createErrorMessage = (taskNumber: number) => `Task no. ${taskNumber} has failed`;
      const createFailingTask = async (taskNumber: number): Promise<number> => {
        await sleep(taskDurationMs);
        throw new Error(createErrorMessage(taskNumber));
      };
      const createSuccessfulTask = async (taskNumber: number): Promise<number> => {
        await sleep(taskDurationMs);
        return taskNumber;
      }

      // Act.
      const executeExclusivePromises: Promise<number>[] = [];
      for (let taskNumber = 0; taskNumber < tasksCount; ++taskNumber) {
        // Even attempts (0-indexed) will fail, while odd attempts will succeed.
        const createTask = taskNumber % 2 === 0 ?
          () => createFailingTask(taskNumber) :
          () => createSuccessfulTask(taskNumber);
        executeExclusivePromises[taskNumber] = lock.executeExclusive(createTask);
        expect(lock.pendingTasksCount).toBe(taskNumber);
        expect(lock.isAvailable).toBe(false);
        expect(lock.currentExecution).toBeDefined();
      }

      let allTasksCompleted = false;
      const waitForCompletionOfAllTasksPromise = (async () => {
        await lock.waitForAllExistingTasksToComplete();
        allTasksCompleted = true;
      })();

      // Assert.
      let expectedBackpressure = tasksCount - 1;
      for (let taskNumber = 0; taskNumber < tasksCount; ++taskNumber) {
        expect(lock.pendingTasksCount).toBe(expectedBackpressure);
        expect(allTasksCompleted).toBe(false);
        expect(lock.isAvailable).toBe(false);
        expect(lock.currentExecution).toBeDefined();

        const shouldSucceed = taskNumber % 2 === 1;
        await Promise.allSettled([
          jest.advanceTimersByTimeAsync(taskDurationMs),
          executeExclusivePromises[taskNumber]
        ]);

        const isLastTask = (taskNumber + 1) === tasksCount;
        if (!isLastTask) {
          --expectedBackpressure;
        }
        expect(lock.pendingTasksCount).toBe(expectedBackpressure);

        // Validate the resolved value or thrown error. Each task should produce
        // a distinct outcome.
        if (shouldSucceed) {
          const result = await executeExclusivePromises[taskNumber];
          expect(result).toBe(taskNumber);
        } else {
          try {
            await executeExclusivePromises[taskNumber];
            expect(true).toBe(false); // The flow should not reach this point.
          } catch (err) {
            const expectedMessage = createErrorMessage(taskNumber);
            expect(err.message).toEqual(expectedMessage);
          }
        }
      }

      await waitForCompletionOfAllTasksPromise;
      expect(allTasksCompleted).toBe(true);
      expect(lock.isAvailable).toBe(true);
      expect(lock.pendingTasksCount).toBe(0);
      expect(lock.currentExecution).toBe(undefined);
      jest.useRealTimers();
    });
  });
});
