/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*
 * Copyright (C) 2022 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { tsp } from '../ts-protocol.js';

export enum RequestQueueingType {
    /**
     * Normal request that is executed in order.
     */
    Normal = 1,

    /**
     * Request that normal requests jump in front of in the queue.
     */
    LowPriority = 2,

    /**
     * A fence that blocks request reordering.
     *
     * Fences are not reordered. Unlike a normal request, a fence will never jump in front of a low priority request
     * in the request queue.
     */
    Fence = 3,
}

export interface RequestItem {
    readonly request: tsp.Request;
    readonly expectsResponse: boolean;
    readonly isAsync: boolean;
    readonly queueingType: RequestQueueingType;
}

export class RequestQueue {
    private readonly queue: RequestItem[] = [];
    private sequenceNumber = 0;

    public get length(): number {
        return this.queue.length;
    }

    public enqueue(item: RequestItem): void {
        if (item.queueingType === RequestQueueingType.Normal) {
            let index = this.queue.length - 1;
            while (index >= 0) {
                if (this.queue[index].queueingType !== RequestQueueingType.LowPriority) {
                    break;
                }
                --index;
            }
            this.queue.splice(index + 1, 0, item);
        } else {
            // Only normal priority requests can be reordered. All other requests just go to the end.
            this.queue.push(item);
        }
    }

    public dequeue(): RequestItem | undefined {
        return this.queue.shift();
    }

    public tryDeletePendingRequest(seq: number): boolean {
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].request.seq === seq) {
                this.queue.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    public createRequest(command: string, args: any): tsp.Request {
        return {
            seq: this.sequenceNumber++,
            type: 'request',
            command: command,
            arguments: args,
        };
    }
}
