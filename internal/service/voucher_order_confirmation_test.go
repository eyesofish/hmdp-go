//go:build integration

package service

import (
	"testing"
	"time"

	"github.com/amemiya02/hmdp-go/internal/global"
	"github.com/amemiya02/hmdp-go/internal/model/entity"
)

func TestConfirmationOnlyMatchesCommittedOrderForOwner(t *testing.T) {
	svc := NewVoucherOrderService()
	orderID := time.Now().UnixNano()
	order := entity.VoucherOrder{ID: orderID, UserID: 30001, VoucherID: uint64(orderID)}
	check := func(userID uint64, want bool) {
		t.Helper()
		got, err := svc.IsOrderConfirmed(setUserContext(userID), orderID)
		if err != nil || got != want {
			t.Fatalf("user %d confirmation = %t, %v; want %t", userID, got, err, want)
		}
	}
	check(order.UserID, false)
	tx := global.Db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err := tx.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	check(order.UserID, false)
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := global.Db.Delete(&order).Error; err != nil {
			t.Errorf("remove test order: %v", err)
		}
	})
	check(order.UserID, true)
	check(order.UserID+1, false)
}
