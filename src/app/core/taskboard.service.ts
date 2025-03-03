import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firestore } from 'firebase/app';
import {
  AngularFirestore,
  AngularFirestoreDocument,
  Action,
  DocumentSnapshot,
  CollectionReference,
  DocumentData,
} from '@angular/fire/firestore';
import { Observable, of, combineLatest } from 'rxjs';
import { switchMap, filter, map } from 'rxjs/operators';

import { AuthService } from '@app/auth/auth.service';
import { FirestoreBoard } from '@core/models/firestore-board.model';
import { FirestoreList } from '@core/models/firestore-list.model';
import { Board } from '@core/models/board.model';
import { User } from '@core/models/user.model';
import { List } from '@core/models/list.model';
import { FirestoreCard } from '@core/models/firestore-card.model';
import { Card } from '@core/models/card.model';
import { FirestoreUser } from '@core/models/firestore-user.model';
import { FirestoreTag } from '@core/models/firestore-tag.model';
import { Tag } from '@core/models/tag.model';
import { BoardBackColor } from '@core/models/board-back-color.model';

@Injectable({ providedIn: 'root' })
export class TaskboardService {
  private currUserId: string;
  private currBoardDoc: AngularFirestoreDocument<FirestoreBoard>;

  constructor(
    private afStore: AngularFirestore,
    private authService: AuthService,
    private router: Router,
  ) {
    this.authService
      .getUser()
      .pipe(filter((user: User | null) => user !== null))
      .subscribe((user: User) => (this.currUserId = user.id));
  }

  // Board methods

  public setCurrBoardDoc(boardId: string): void {
    this.currBoardDoc = this.afStore.doc<FirestoreBoard>(`boards/${boardId}`);
  }

  public getPersonalBoards(): Observable<(FirestoreBoard & { id: string })[]> {
    return this.authService.getUser().pipe(
      switchMap((user: User) => {
        if (!user) {
          return of(null);
        }
        return this.afStore
          .collection<FirestoreBoard>('boards', (ref: CollectionReference) =>
            ref
              .where('membersIds', 'array-contains', user.id)
              .orderBy('createdAt', 'desc'),
          )
          .valueChanges({ idField: 'id' });
      }),
    );
  }

  public getFavoriteBoards(): Observable<(FirestoreBoard & { id: string })[]> {
    return this.authService.getUser().pipe(
      switchMap((user: User) => {
        if (!user) {
          return of(null);
        }
        return this.afStore
          .collection<FirestoreBoard>('boards', (ref: CollectionReference) =>
            ref
              .where('usersIdsWhoseBoardIsFavorite', 'array-contains', user.id)
              .orderBy('createdAt', 'desc'),
          )
          .valueChanges({ idField: 'id' });
      }),
    );
  }

  public async createBoard(
    title: string,
    backgroundColor: string,
  ): Promise<firestore.DocumentReference> {
    const boardDoc = await this.afStore
      .collection<FirestoreBoard>('boards')
      .add({
        title,
        backgroundColor,
        adminId: this.currUserId,
        membersIds: [this.currUserId],
        createdAt: firestore.Timestamp.now(),
        usersIdsWhoseBoardIsFavorite: [],
      });
    Object.values(BoardBackColor).forEach((color: string) => {
      boardDoc.collection('tags').add({
        color,
        name: '',
      });
    });
    return boardDoc;
  }

  public updateBoardData(data: Partial<FirestoreBoard>): Promise<void> {
    return this.currBoardDoc.update(data);
  }

  public async addMemberToBoard(
    newMemberUsername: string,
  ): Promise<string | void> {
    const snapshot: firestore.QuerySnapshot = await this.afStore
      .collection('users', (ref: CollectionReference) =>
        ref.where('username', '==', newMemberUsername),
      )
      .get()
      .toPromise();
    if (snapshot.empty) {
      return Promise.reject(`(${newMemberUsername})Bu Kullanıcı Bulunamadı`);
    }
    const newMemberId = snapshot.docs[0].id;
    return this.updateBoardData({
      membersIds: firestore.FieldValue.arrayUnion(newMemberId),
    });
  }

  public removeMemberFromBoard(memberId: string): Promise<void> {
    if (memberId === this.currUserId) {
      this.router.navigateByUrl('/boards');
    }
    return this.updateBoardData({
      membersIds: firestore.FieldValue.arrayRemove(memberId),
    });
  }

  public getBoardData(): Observable<Board> {
    let boardData;
    return this.currBoardDoc.snapshotChanges().pipe(
      map(this.getDocDataWithId),
      switchMap((firestoreBoard: FirestoreBoard & { id: string }) => {
        const { membersIds, ...board } = firestoreBoard;
        boardData = board;
        const members$: Observable<User>[] = membersIds.map((userId: string) =>
          this.afStore
            .doc<FirestoreUser>(`users/${userId}`)
            .snapshotChanges()
            .pipe(map(this.getDocDataWithId)),
        );
        return combineLatest(members$);
      }),
      map((members: User[]) => {
        return { members, ...boardData };
      }),
    );
  }

  public getBoardTags(): Observable<Tag[]> {
    return this.currBoardDoc
      .collection<FirestoreTag>('tags')
      .valueChanges({ idField: 'id' });
  }

  public updateBoardTagName(tagId: string, newTagName: string): Promise<void> {
    return this.currBoardDoc
      .collection('tags')
      .doc<FirestoreTag>(tagId)
      .update({
        name: newTagName,
      });
  }

  public async removeBoard(): Promise<void> {
    this.router.navigateByUrl('/boards');
    await this.removeAllBoardLists();
    return this.currBoardDoc.delete();
  }

  // List methods

  public getBoardLists(): Observable<List[]> {
    return this.currBoardDoc
      .collection<FirestoreList>('lists', (ref: CollectionReference) =>
        ref.orderBy('createdAt'),
      )
      .valueChanges({ idField: 'id' });
  }

  public createList(listTitle: string): Promise<firestore.DocumentReference> {
    return this.currBoardDoc.collection<FirestoreList>('lists').add({
      title: listTitle,
      creatorId: this.currUserId,
      createdAt: firestore.Timestamp.now(),
    });
  }

  public updateListData(
    listId: string,
    data: Partial<FirestoreList>,
  ): Promise<void> {
    return this.currBoardDoc
      .collection('lists')
      .doc(listId)
      .update(data);
  }

  addBoardToFavorites(): Promise<void> {
    return this.updateBoardData({
      usersIdsWhoseBoardIsFavorite: firestore.FieldValue.arrayUnion(
        this.currUserId,
      ),
    });
  }

  removeBoardFromFavorites(): Promise<void> {
    return this.updateBoardData({
      usersIdsWhoseBoardIsFavorite: firestore.FieldValue.arrayRemove(
        this.currUserId,
      ),
    });
  }

  public async removeList(
    listId: string,
    listCreatorId?: string,
  ): Promise<string | void> {
    if (listCreatorId !== this.currUserId) {
      return Promise.reject(
        'Yalnızca yönetici veya yaratıcının bu süreçleri silme izni vardır.',
      );
    }
    await this.removeAllListCards(listId).catch(() =>
      Promise.reject("Süreçlerde başka üye kartları olduğu için süreç silinemiyor."),
    );
    return this.currBoardDoc
      .collection('lists')
      .doc(listId)
      .delete();
  }

  // Card methods

  public getCardData(listId: string, cardId: string): Observable<Card> {
    let cardData: any;
    return this.currBoardDoc
      .collection(`lists/${listId}/cards`)
      .doc<FirestoreCard>(cardId)
      .snapshotChanges()
      .pipe(
        map(this.getDocDataWithId),
        switchMap((firestoreCard: FirestoreCard) => {
          const { tagsIds, membersIds, ...card } = firestoreCard;
          cardData = card;
          const tagsArray$: Observable<Tag>[] = tagsIds.map((tagId: string) => {
            return this.currBoardDoc
              .collection('tags')
              .doc<FirestoreTag>(tagId)
              .snapshotChanges()
              .pipe(map(this.getDocDataWithId));
          });
          const membersArray$: Observable<User>[] = membersIds.map(
            (userId: string) => {
              return this.afStore
                .collection('users')
                .doc<FirestoreUser>(userId)
                .snapshotChanges()
                .pipe(map(this.getDocDataWithId));
            },
          );
          const tags$: Observable<Tag[]> = tagsArray$.length
            ? combineLatest(tagsArray$)
            : of([]);
          const members$: Observable<User[]> = membersArray$.length
            ? combineLatest(membersArray$)
            : of([]);
          return combineLatest(tags$, members$);
        }),
        map((transformedData: any[]) => {
          const [tags, members] = transformedData;
          return { tags, members, ...cardData };
        }),
      );
  }

  public getListCards(listId: string): Observable<Card[]> {
    return this.currBoardDoc
      .collection<FirestoreCard>(
        `lists/${listId}/cards`,
        (ref: CollectionReference) => ref.orderBy('positionNumber'),
      )
      .valueChanges({ idField: 'id' })
      .pipe(
        switchMap((cards: (FirestoreCard & { id: string })[]) => {
          const cards$ = cards.map((card: FirestoreCard & { id: string }) =>
            this.getCardData(listId, card.id),
          );
          return cards$.length ? combineLatest(cards$) : of([]);
        }),
      );
  }

  public createCard(
    listId: string,
    title: string,
    positionNumber: number,
  ): Promise<firestore.DocumentReference> {
    return this.currBoardDoc
      .collection<FirestoreCard>(`lists/${listId}/cards`)
      .add({
        title,
        positionNumber,
        description: '',
        creatorId: this.currUserId,
        membersIds: [],
        usersIdsWhoVoted: [],
        tagsIds: [],
        attachments: [],
        wallpaperURL: '',
        createdAt: firestore.Timestamp.now(),
      });
  }

  public updateCardData(
    listId: string,
    cardId: string,
    data: Partial<FirestoreCard>,
  ): Promise<void> {
    return this.currBoardDoc
      .collection(`lists/${listId}/cards`)
      .doc(cardId)
      .update(data);
  }

  public removeCard(
    listId: string,
    cardId: string,
    isLastInList: boolean,
  ): Promise<void> {
    return this.currBoardDoc
      .collection(`lists/${listId}/cards`)
      .doc(cardId)
      .delete()
      .catch((err: firestore.FirestoreError) => {
        if (err.code === 'permission-denied') {
          return Promise.reject(
            'Yalnızca yönetici veya oluşturucunun bu kartı silme izni vardır.',
          );
        }
      })
      .then(() => {
        if (!isLastInList) {
          return this.updateCardsPositionNumber(listId);
        }
      });
  }

  public async updateCardsPositionNumber(
    listId: string,
    modifiedCards?: Card[],
  ): Promise<void> {
    const batch = this.afStore.firestore.batch();
    if (modifiedCards) {
      modifiedCards.forEach((card, index) => {
        const cardDocRef = this.currBoardDoc
          .collection(`lists/${listId}/cards`)
          .doc(card.id).ref;
        batch.update(cardDocRef, { positionNumber: index + 1 });
      });
    } else {
      const cardsSnapshot = await this.currBoardDoc
        .collection(`lists/${listId}/cards`)
        .ref.orderBy('positionNumber')
        .get();
      cardsSnapshot.docs.forEach((cardDocRef, index) => {
        batch.update(cardDocRef.ref, { positionNumber: index + 1 });
      });
    }
    return batch.commit();
  }

  public async moveCardToAnotherList(
    srcListId: string,
    destListId: string,
    cardId: string,
    newCardPosition: number,
    isLastInSrcList: boolean,
    isLastInDestList: boolean,
  ) {
    const srcList = this.currBoardDoc.collection(`lists/${srcListId}/cards`);
    const destList = this.currBoardDoc.collection(`lists/${destListId}/cards`);
    const cardDocSnapshot = await srcList
      .doc<FirestoreCard>(cardId)
      .get()
      .toPromise();
    const cardData = cardDocSnapshot.data();
    cardData['positionNumber'] = isLastInDestList
      ? newCardPosition - 0.5
      : newCardPosition;
    await destList
      .doc(cardId)
      .set({ ...cardData })
      .catch(console.error);
    const res = await srcList
      .doc(cardId)
      .delete()
      .catch(console.error);
    if (!isLastInSrcList) {
      this.updateCardsPositionNumber(srcListId);
    }
    if (!isLastInDestList) {
      this.updateCardsPositionNumber(destListId);
    }
    return res;
  }

  private async removeAllBoardLists(): Promise<void> {
    const listsQuerySnapshot: firestore.QuerySnapshot = await this.currBoardDoc
      .collection('lists')
      .ref.get();
    for (const listDocSnapshot of listsQuerySnapshot.docs) {
      await this.removeList(listDocSnapshot.id);
    }
  }

  private async removeAllListCards(listId: string): Promise<void> {
    const cardsQuerySnapshot: firestore.QuerySnapshot = await this.currBoardDoc
      .collection(`lists/${listId}/cards`)
      .ref.get();
    const { docs } = cardsQuerySnapshot;
    const hasPermissionToDelete = docs.every(
      (cardSnapshot: firestore.QueryDocumentSnapshot) => {
        const cardData: DocumentData = cardSnapshot.data();
        return cardData['creatorId'] === this.currUserId;
      },
    );
    if (!hasPermissionToDelete) return Promise.reject();
    for (const cardDocSnapshot of docs) {
      const cardToDeleteData = cardDocSnapshot.data();
    }
  }

  private getDocDataWithId(action: Action<DocumentSnapshot<any>>): any {
    const { payload } = action;
    const id = payload.id;
    const data = payload.data();
    return { id, ...data };
  }
}
