<h2 align="middle">zero-overhead-promise-lock</h2>

The `ZeroOverheadLock` class implements a modern Promise-lock for Node.js projects, enabling users to ensure the mutually exclusive execution of specified tasks. Key features include:
* __Graceful Teardown__: The ability to await the completion of all currently executing or pending tasks, making it ideal for production applications that require smooth and controlled shutdowns.
* __"Check-and-Abort" Friendly__: The `isAvailable` getter is designed for "check-and-abort" scenarios, enabling operations to be skipped or aborted if the lock is currently held by another task.

Unlike single-threaded C code, the event-loop architecture used in modern JavaScript runtime environments introduces the possibility of race conditions, especially for asynchronous tasks that span multiple event-loop iterations.  
In Node.js, synchronous code blocks - those that do **not** contain an `await` keyword - are guaranteed to execute within a single event-loop iteration. These blocks inherently do not require synchronization, as their execution is mutually exclusive by definition and cannot overlap.  
In contrast, asynchronous tasks that include at least one `await`, necessarily span across **multiple event-loop iterations**. Such tasks may require synchronization to prevent overlapping executions that could lead to **race conditions**, resulting in inconsistent or invalid states.

Additionally, locks are sometimes employed **purely for performance optimization**, such as throttling, rather than for preventing race conditions. In such cases, the lock effectively functions as a semaphore with a concurrency of 1.  
If your use case requires a concurrency greater than 1, consider using the semaphore variant of this package: [zero-backpressure-semaphore-typescript](https://www.npmjs.com/package/zero-backpressure-semaphore-typescript). While semaphores can emulate locks by setting their concurrency to 1, locks provide a more efficient implementation with reduced overhead.

## Table of Contents

* [Key Features](#key-features)
* [Modern API Design](#modern-api-design)
* [API](#api)
* [Getter Methods](#getter-methods)
* [Opt for Atomic Operations When Working Against External Resources](#opt-atomic-operations)
* [Using Locks as a Semaphore with a Concurrency of 1](#lock-as-semaphore)
* [Use Case Example: Aggregating Intrusion Detection Event Logs](#use-case-example)
* [License](#license)

## Key Features :sparkles:<a id="key-features"></a>

- __Mutual Exclusiveness :lock:__: Ensures the mutually exclusive execution of asynchronous tasks, either to prevent potential race conditions caused by tasks spanning across multiple event-loop iterations, or for performance optimization.
- __Graceful Termination :hourglass_flowing_sand:__: Await the completion of all currently pending and executing tasks using the `waitForAllExistingTasksToComplete` method. Example use cases include application shutdowns (e.g., `onModuleDestroy` in Nest.js applications) or maintaining a clear state between unit-tests.
- __Suitable for "check and abort" scenarios__: The `isAvailable` getter indicator enables to skip or abort operations if the lock is currently held by another task.
- __High Efficiency :gear:__: Leverages the Node.js microtasks queue to serve tasks in FIFO order, eliminating the need for manually managing an explicit queue of pending tasks.
- __Comprehensive documentation :books:__: The class is thoroughly documented, enabling IDEs to provide helpful tooltips that enhance the coding experience.
- __Tests :test_tube:__: Fully covered by extensive unit tests.
- __No external runtime dependencies__: Only development dependencies are used.
- __ES2020 Compatibility__: The `tsconfig` target is set to ES2020.
- TypeScript support.

## Modern API Design :rocket:<a id="modern-api-design"></a>

Traditional lock APIs require explicit *acquire* and *release* steps, adding overhead and responsibility for the user. Additionally, they introduce the **risk of deadlocking the application** if one forgets to *release*, for example, due to a thrown exception.

In contrast, `ZeroOverheadLock` manages task execution, abstracting away these details and reducing user responsibility. The *acquire* and *release* steps are handled implicitly by the `executeExclusive` method, reminiscent of the RAII idiom in C++.

## API :globe_with_meridians:<a id="api"></a>

The `ZeroOverheadLock` class provides the following methods:

* __executeExclusive__: Executes the given task in a controlled manner, once the lock is available. It resolves or rejects when the task finishes execution, returning the task's value or propagating any error it may throw.
* __waitForAllExistingTasksToComplete__: Waits for the completion of all tasks that are *currently* pending or executing. This method is particularly useful in scenarios where it is essential to ensure that all tasks - whether already executing or queued - are fully processed before proceeding. Examples include **application shutdowns** (e.g., `onModuleDestroy` in Nest.js applications) or maintaining a clear state between unit tests.

If needed, refer to the code documentation for a more comprehensive description of each method.

## Getter Methods :mag:<a id="getter-methods"></a>

The `ZeroOverheadLock` class provides the following getter method to reflect the current lock's state:

* __isAvailable__: Indicates whether the lock is currently available to immediately begin executing a new task. This property is particularly useful in "check and abort" scenarios, where an operation should be **skipped or aborted** if the lock is currently held by another task.

## Opt for Atomic Operations When Working Against External Resources :key:<a id="opt-atomic-operations"></a>

A common example of using locks is the READ-AND-UPDATE scenario, where concurrent reads of the same value can lead to erroneous updates. While such examples are intuitive, they are often less relevant in modern applications due to advancements in databases and external storage solutions. Modern databases, as well as caches like Redis, provide native support for atomic operations. **Always prioritize leveraging atomicity in external resources** before resorting to in-memory locks.

### Example: Incrementing a Counter in MongoDB
Consider the following function that increments the number of product views for the last hour in a MongoDB collection. Using two separate operations, this implementation introduces a race condition:
```ts
async function updateViews(products: Collection<IProductSchema>, productID: string): Promise<void> {
  const product = await products.findOne({ _id: productID }); // Step 1: Read
  if (!product) return;

  const currentViews = product?.hourlyViews ?? 0;
  await products.updateOne(
    { _id: productID },
    { $set: { hourlyViews: currentViews + 1 } } // Step 2: Update
  );
}
```
The race condition occurs when two or more processes or concurrent tasks (Promises within the same process) execute this function simultaneously, potentially leading to incorrect counter values. This can be mitigated by using MongoDB's atomic `$inc` operator, as shown below:
```ts
async function updateViews(products: Collection<IProductSchema>, productID: string): Promise<void> {
    await products.updateOne(
        { _id: productID },
        { $inc: { hourlyViews: 1 } } // Atomic increment
    );
}
```
By combining the read and update into a single atomic operation, the code avoids the need for locks and improves both reliability and performance.

## Using Locks as a Semaphore with a Concurrency of :one:<a id="lock-as-semaphore"></a>

In scenarios where performance considerations require controlling access, in-memory locks can be useful. For example, limiting concurrent access to a shared resource may be necessary to reduce contention or meet operational constraints. In such cases, locks are employed as a semaphore with a concurrency limit of 1, ensuring that no more than one operation is executed at a time.

## Use Case Example: Aggregating Intrusion Detection Event Logs :shield:<a id="use-case-example"></a>

In an Intrusion Detection System (IDS), it is common to aggregate non-critical alerts (e.g., low-severity anomalies) in memory and flush them to a database in bulk. This approach minimizes the load caused by frequent writes for non-essential data. The bulk writes occur either periodically or whenever the accumulated data reaches a defined threshold.

Below, we explore implementation options for managing these bulk writes while **addressing potential race conditions** that could lead to data consistency issues.

### Naive Implementation with Race Condition Risk

The following implementation demonstrates the aggregation logic. For simplicity, error handling is omitted to focus on identifying and fixing the race condition:
```ts
import { IAlertMetadata } from './interfaces';

export class IntrusionDetectionSystem {
  private _accumulatedAlerts: Readonly<IAlertMetadata>[] = [];

  constructor(private readonly _maxAccumulatedAlerts: number) {}

  // Naive implementation:
  public async addAlert(alert: Readonly<IAlertMetadata>): Promise<void> {
    this._accumulatedAlerts.push(alert);

    if (this._accumulatedAlerts.length >= this._maxAccumulatedAlerts) {
      await this._flushToDb(this._accumulatedAlerts);
      this._accumulatedAlerts = [];
    }
  }

  private async _flushToDb(alerts: IAlertMetadata[]): Promise<void> {
    // Perform a bulk write to an external resource.
  }
}
```

#### Issue
Resetting `_accumulatedAlerts` only after the bulk-write completes introduces the risk of accumulating additional alerts during the write operation. This can result in duplicate processing or excessive database writes.

### Using a Lock to Ensure Atomicity

To resolve the race condition, the `addAlert` logic can be treated as a critical section, protected by a lock:
```ts
import { ZeroOverheadLock } from 'zero-overhead-promise-lock';
import { IAlertMetadata } from './interfaces';

export class IntrusionDetectionSystem {
  private readonly _accumulationLock = new ZeroOverheadLock<void>();
  private _accumulatedAlerts: Readonly<IAlertMetadata>[] = [];

  constructor(private readonly _maxAccumulatedAlerts: number) {}

  public async addAlert(alert: Readonly<IAlertMetadata>): Promise<void> {
    await this._accumulationLock.executeExclusive(async () => {
      this._accumulatedAlerts.push(alert);

      if (this._accumulatedAlerts.length >= this._maxAccumulatedAlerts) {
        await this._flushToDb(this._accumulatedAlerts);
        this._accumulatedAlerts = [];
      }
    });
  }

  /**
   * Gracefully awaits the completion of all ongoing tasks before shutdown.
   * This method is well-suited for use in `onModuleDestroy` in Nest.js 
   * applications or similar lifecycle scenarios.
   */
  public async onDestroy(): Promise<void> {
    while (!this._accumulationLock.isAvailable) {
      await this._accumulationLock.waitForAllExistingTasksToComplete();
    }
  }

  private async _flushToDb(alerts: IAlertMetadata[]): Promise<void> {
    // Perform a bulk write to an external resource.
  }
}
```

#### Tradeoff
While this ensures correctness, it introduces potential backpressure. The lock prevents concurrent accumulation during a bulk write, possibly blocking alert processing during high throughput periods.

### Optimized Approach: Lock Bulk Write Only

A more efficient solution involves separating the logic for resetting the accumulation array from the bulk write operation itself. This guarantees that only one bulk write is active while allowing uninterrupted accumulation:
```ts
import { ZeroOverheadLock } from 'zero-overhead-promise-lock';
import { IAlertMetadata } from './interfaces';

export class IntrusionDetectionSystem {
  private readonly _bulkWriteLock = new ZeroOverheadLock<void>();
  private _accumulatedAlerts: Readonly<IAlertMetadata>[] = [];

  constructor(private readonly _maxAccumulatedAlerts: number) {}

  public async addAlert(alert: Readonly<IAlertMetadata>): Promise<void> {
    this._accumulatedAlerts.push(alert);

    if (this._accumulatedAlerts.length < this._maxAccumulatedAlerts) {
      return;
    }

    const currentBatch = this._accumulatedAlerts;
    this._accumulatedAlerts = [];
    await this._bulkWriteLock.executeExclusive(
      () => this._flushToDb(currentBatch);
    );
  }

  /**
   * Gracefully awaits the completion of all ongoing tasks before shutdown.
   * This method is well-suited for use in `onModuleDestroy` in Nest.js 
   * applications or similar lifecycle scenarios.
   */
  public async onDestroy(): Promise<void> {
    while (!this._bulkWriteLock.isAvailable) {
      await this._bulkWriteLock.waitForAllExistingTasksToComplete();
    }
  }

  private async _flushToDb(alerts: IAlertMetadata[]): Promise<void> {
    // Perform a bulk write to an external resource.
  }
}
```

### Key Benefits of the Optimized Approach

* __Improved Throughput__: In-memory accumulation remains active while bulk writes occur, reducing backpressure.
* __Self-Throttling__: Prevents multiple simultaneous bulk writes while enabling continuous alert ingestion.

## License :scroll:<a id="license"></a>

[Apache 2.0](LICENSE)
